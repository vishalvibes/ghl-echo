import {
  judgeOutputSchema,
  scoreCall,
  type Criterion,
  type JudgeOutput,
  type Transcript,
  type Verdict,
} from '@copilot/shared'
import { completeStructured, type StructuredResult } from '../lib/llm.js'
import { buildJudgeUserPrompt, JUDGE_SYSTEM_PROMPT, type JudgeContext } from './prompts.js'

export interface JudgeInput {
  transcript: Transcript
  criteria: Criterion[]
  passThreshold: number
  partialThreshold: number
  context: JudgeContext
}

export interface JudgeResult {
  output: JudgeOutput
  overallScore: number
  verdict: Verdict
  missingKeys: string[]
  model: string
  latencyMs: number
  promptTokens: number
  completionTokens: number
}

/**
 * Discard judgements the model invented and clamp the ones it exaggerated.
 *
 * The model is the least trustworthy component in the pipeline, so its output
 * is treated as a proposal. Anything referencing a turn that does not exist is
 * dropped rather than stored: a highlight pointing at turn 47 of a 12-turn call
 * makes the whole dashboard look broken, and silently keeping it is worse than
 * losing one finding.
 */
export function sanitizeJudgeOutput(output: JudgeOutput, transcript: Transcript): JudgeOutput {
  const validTurnIds = new Set(transcript.map((t) => t.id))
  const maxTurnId = transcript.length - 1
  const keep = (ids: number[]) => ids.filter((id) => validTurnIds.has(id))

  return {
    ...output,
    criteria: output.criteria.map((c) => ({ ...c, evidenceTurnIds: keep(c.evidenceTurnIds) })),
    findings: output.findings.map((f) => ({ ...f, turnIds: keep(f.turnIds) })),
    segments: output.segments
      .filter((s) => validTurnIds.has(s.turnStart))
      .map((s) => ({
        ...s,
        // A range that runs past the end is usually an off-by-one, not a
        // hallucination — clamp it instead of dropping a real action item.
        turnEnd: Math.min(Math.max(s.turnEnd, s.turnStart), maxTurnId),
      })),
  }
}

/** Criteria the judge returned that are not in the scorecard. */
export function findUnknownKeys(output: JudgeOutput, criteria: Criterion[]): string[] {
  const known = new Set(criteria.map((c) => c.key))
  return output.criteria.map((c) => c.key).filter((key) => !known.has(key))
}

export async function judgeCall(input: JudgeInput): Promise<JudgeResult> {
  const active = input.criteria.filter((c) => c.enabled)
  if (active.length === 0) {
    throw new Error('Scorecard has no enabled criteria — nothing to judge')
  }

  const result: StructuredResult<JudgeOutput> = await completeStructured({
    system: JUDGE_SYSTEM_PROMPT,
    user: buildJudgeUserPrompt({ criteria: input.criteria }, input.transcript, input.context),
    schema: judgeOutputSchema,
    maxOutputTokens: 4000,
  })

  const known = new Set(active.map((c) => c.key))
  const sanitized = sanitizeJudgeOutput(result.data, input.transcript)
  // Drop invented criteria before scoring so they cannot dilute the weights.
  const output: JudgeOutput = {
    ...sanitized,
    criteria: sanitized.criteria.filter((c) => known.has(c.key)),
  }

  const breakdown = scoreCall(active, output.criteria, {
    passThreshold: input.passThreshold,
    partialThreshold: input.partialThreshold,
  })

  return {
    output,
    overallScore: breakdown.overallScore,
    verdict: breakdown.verdict,
    missingKeys: breakdown.missingKeys,
    model: result.model,
    latencyMs: result.latencyMs,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  }
}
