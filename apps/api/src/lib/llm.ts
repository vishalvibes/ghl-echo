import OpenAI from 'openai'
import type { z } from 'zod'
import { env, llmEnabled } from '../config/env.js'

/**
 * Thin wrapper around the chat completions API that returns validated,
 * schema-shaped objects. Everything downstream consumes typed data, so a
 * malformed model response fails here rather than corrupting the database.
 */

let client: OpenAI | null = null

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

function getClient(): OpenAI {
  if (!llmEnabled) {
    throw new LlmDisabledError()
  }
  if (!client) {
    client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      // Always a concrete URL. Left undefined the SDK falls back to
      // process.env.OPENAI_BASE_URL, and an *empty* value there — the common
      // `.env` shape — is not nullish, so it wins and every request fails with
      // "Request URL is missing an 'http://' or 'https://' protocol".
      baseURL: env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    })
  }
  return client
}

export class LlmDisabledError extends Error {
  readonly code = 'LLM_DISABLED'
  constructor() {
    super('LLM is disabled — set OPENAI_ENABLED=true and OPENAI_API_KEY')
    this.name = 'LlmDisabledError'
  }
}

export class LlmParseError extends Error {
  readonly code = 'LLM_PARSE_FAILED'
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message)
    this.name = 'LlmParseError'
  }
}

export interface StructuredResult<T> {
  data: T
  model: string
  latencyMs: number
  promptTokens: number
  completionTokens: number
  /** True when the first attempt returned unparseable JSON and we retried. */
  retried: boolean
}

export interface StructuredRequest<T> {
  system: string
  user: string
  schema: z.ZodType<T>
  /** Lower for judging (consistency), higher for recommendations (variety). */
  temperature?: number
  maxOutputTokens?: number
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  // Models occasionally wrap JSON in a fenced block despite json_object mode.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  const candidate = fenced?.[1] ?? trimmed
  return JSON.parse(candidate)
}

/**
 * Call the model and parse its reply against `schema`.
 *
 * Retries exactly once, feeding the validation error back to the model. One
 * retry catches the common "forgot a field" case; more than that usually means
 * the prompt is wrong, and burning tokens on it hides the real problem.
 */
export async function completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const openai = getClient()
  const started = Date.now()

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: req.system },
    { role: 'user', content: req.user },
  ]

  let promptTokens = 0
  let completionTokens = 0
  let lastRaw = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      temperature: req.temperature ?? 0.1,
      max_completion_tokens: req.maxOutputTokens ?? 4000,
      response_format: { type: 'json_object' },
    })

    promptTokens += response.usage?.prompt_tokens ?? 0
    completionTokens += response.usage?.completion_tokens ?? 0
    lastRaw = response.choices[0]?.message?.content ?? ''

    let issues: string
    try {
      const parsed = req.schema.safeParse(extractJson(lastRaw))
      if (parsed.success) {
        return {
          data: parsed.data,
          model: env.OPENAI_MODEL,
          latencyMs: Date.now() - started,
          promptTokens,
          completionTokens,
          retried: attempt > 0,
        }
      }
      issues = parsed.error.issues.map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
    } catch (error) {
      issues = `- (root): response was not valid JSON — ${(error as Error).message}`
    }

    messages.push({ role: 'assistant', content: lastRaw })
    messages.push({
      role: 'user',
      content: `That response did not match the required schema:\n${issues}\n\nReturn corrected JSON only.`,
    })
  }

  throw new LlmParseError('Model output failed schema validation twice', lastRaw)
}
