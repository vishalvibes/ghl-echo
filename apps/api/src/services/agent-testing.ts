import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type {
  AgentTestingJob,
  Criterion,
  SuggestTestPromptResponse,
  TestCase,
  TestCaseTranscriptResult,
  TestCriterion,
  Turn,
} from '@copilot/shared'
import { expandedTestCaseSchema, suggestedTestPromptSchema } from '@copilot/shared'
import { db } from '../db/client.js'
import { agents, testCases } from '../db/schema.js'
import { completeStructured } from '../lib/llm.js'
import { judgeCall, type JudgeResult } from '../scoring/judge.js'
import {
  buildExpandTestCaseUserPrompt,
  buildSuggestTestPromptUser,
  EXPAND_TEST_CASE_SYSTEM_PROMPT,
  SUGGEST_TEST_PROMPT_SYSTEM,
} from '../scoring/test-case-prompts.js'

/** Fixed verdict cutoffs for synthetic tests — not stored per edge case. */
export const TEST_CASE_PASS_THRESHOLD = 70
export const TEST_CASE_PARTIAL_THRESHOLD = 40

export function serializeTestCase(row: typeof testCases.$inferSelect): TestCase {
  return {
    id: row.id,
    agentId: row.agentId,
    edgeCase: row.edgeCase,
    scenario: row.scenario,
    criteria: row.criteria,
    transcripts: row.transcripts,
    results: row.results ?? null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function toJudgeCriteria(criteria: TestCriterion[]): Criterion[] {
  return criteria.map((c) => ({
    key: c.key,
    label: c.label,
    type: 'boolean' as const,
    weight: 1,
    definition: c.description,
    failWhen: null,
    enabled: true,
  }))
}

function improvementFeedback(judged: JudgeResult): string | null {
  if (judged.verdict === 'pass') return null
  const finding = judged.output.findings[0]
  if (finding?.title?.trim()) return finding.title.trim().slice(0, 200)
  const unmet = judged.output.criteria.find((c) => !c.met)
  if (unmet?.rationale?.trim()) return unmet.rationale.trim().slice(0, 200)
  return 'Agent missed one or more test criteria.'
}

function normalizeTranscript(turns: Turn[]): Turn[] {
  return turns.map((turn, id) => ({ ...turn, id }))
}

export function isTestingJobActive(job: AgentTestingJob | null | undefined): boolean {
  return job?.status === 'queued' || job?.status === 'running'
}

export function createQueuedTestingJob(
  type: AgentTestingJob['type'],
  total: number,
  label: string,
): AgentTestingJob {
  return {
    id: randomUUID(),
    type,
    status: 'queued',
    progress: { done: 0, total, label },
    error: null,
    suggestion: null,
    updatedAt: new Date().toISOString(),
  }
}

export async function writeTestingJob(
  agentId: string,
  locationId: string,
  job: AgentTestingJob | null,
): Promise<void> {
  await db
    .update(agents)
    .set({ testingJob: job })
    .where(and(eq(agents.id, agentId), eq(agents.locationId, locationId)))
}

export async function patchTestingJob(
  agentId: string,
  locationId: string,
  jobId: string,
  patch: Partial<Omit<AgentTestingJob, 'id'>>,
): Promise<AgentTestingJob | null> {
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.locationId, locationId)),
    columns: { testingJob: true },
  })
  if (!agent?.testingJob || agent.testingJob.id !== jobId) return null
  const next: AgentTestingJob = {
    ...agent.testingJob,
    ...patch,
    progress: patch.progress ?? agent.testingJob.progress,
    updatedAt: new Date().toISOString(),
  }
  await writeTestingJob(agentId, locationId, next)
  return next
}

export async function loadAgentForTesting(agentId: string, locationId: string) {
  return db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.locationId, locationId)),
  })
}

/** Expand one edge case into scenario + criteria + mock transcripts. */
export async function expandEdgeCase(args: {
  agentName: string
  agentPrompt: string
  goals: string[]
  edgeCase: string
}): Promise<{
  edgeCase: string
  scenario: string[]
  criteria: TestCriterion[]
  transcripts: Turn[][]
}> {
  const result = await completeStructured({
    system: EXPAND_TEST_CASE_SYSTEM_PROMPT,
    user: buildExpandTestCaseUserPrompt(args),
    schema: expandedTestCaseSchema,
    maxOutputTokens: 12_000,
  })
  return {
    edgeCase: args.edgeCase,
    scenario: result.data.scenario,
    criteria: result.data.criteria,
    transcripts: result.data.transcripts.map((transcript) => normalizeTranscript(transcript.turns)),
  }
}

/** Replace all test packs for an agent with the expanded set. */
export async function replaceTestCases(args: {
  agentId: string
  locationId: string
  packs: Array<{
    edgeCase: string
    scenario: string[]
    criteria: TestCriterion[]
    transcripts: Turn[][]
  }>
}): Promise<TestCase[]> {
  const saved = await db.transaction(async (tx) => {
    await tx
      .delete(testCases)
      .where(and(eq(testCases.agentId, args.agentId), eq(testCases.locationId, args.locationId)))
    if (args.packs.length === 0) return []
    return tx
      .insert(testCases)
      .values(
        args.packs.map((row) => ({
          locationId: args.locationId,
          agentId: args.agentId,
          edgeCase: row.edgeCase,
          scenario: row.scenario,
          criteria: row.criteria,
          transcripts: row.transcripts,
          results: null,
        })),
      )
      .returning()
  })
  return saved.map(serializeTestCase)
}

/** Judge one mock transcript and return the scored result row. */
export async function judgeTestTranscript(args: {
  agentName: string
  agentPrompt: string | null
  promptSnapshot: string | null
  criteria: TestCriterion[]
  transcript: Turn[]
  transcriptIndex: number
}): Promise<TestCaseTranscriptResult> {
  const judged = await judgeCall({
    transcript: args.transcript,
    criteria: toJudgeCriteria(args.criteria),
    passThreshold: TEST_CASE_PASS_THRESHOLD,
    partialThreshold: TEST_CASE_PARTIAL_THRESHOLD,
    context: {
      agentName: args.agentName,
      agentPrompt: args.agentPrompt ?? args.promptSnapshot,
      direction: 'inbound',
      durationSec: 0,
      outcome: 'completed',
    },
  })
  const byKey = new Map(judged.output.criteria.map((c) => [c.key, c]))
  return {
    transcriptIndex: args.transcriptIndex,
    criteria: args.criteria.map((c) => {
      const hit = byKey.get(c.key)
      return {
        key: c.key,
        met: hit?.met ?? false,
        rationale: hit?.rationale ?? 'No judgement returned for this criterion.',
      }
    }),
    feedback: improvementFeedback(judged),
  }
}

export async function persistTestCaseResults(
  testCaseId: string,
  results: TestCaseTranscriptResult[],
): Promise<void> {
  await db
    .update(testCases)
    .set({ results, lastRunAt: new Date() })
    .where(eq(testCases.id, testCaseId))
}

export function collectFailedCriteria(
  rows: Array<{
    edgeCase: string
    criteria: TestCriterion[]
    results: TestCaseTranscriptResult[] | null
  }>,
): Array<{
  edgeCase: string
  criterionLabel: string
  criterionDescription: string
  rationale: string
  feedback: string | null
}> {
  const failures: Array<{
    edgeCase: string
    criterionLabel: string
    criterionDescription: string
    rationale: string
    feedback: string | null
  }> = []
  for (const row of rows) {
    if (!row.results?.length) continue
    const byKey = new Map(row.criteria.map((c) => [c.key, c]))
    for (const result of row.results) {
      for (const scored of result.criteria) {
        if (scored.met) continue
        const meta = byKey.get(scored.key)
        failures.push({
          edgeCase: row.edgeCase,
          criterionLabel: meta?.label ?? scored.key,
          criterionDescription: meta?.description ?? '',
          rationale: scored.rationale,
          feedback: result.feedback,
        })
      }
    }
  }
  return failures
}

export async function suggestRevisedPrompt(args: {
  agentName: string
  currentPrompt: string
  failures: ReturnType<typeof collectFailedCriteria>
}): Promise<SuggestTestPromptResponse> {
  const result = await completeStructured({
    system: SUGGEST_TEST_PROMPT_SYSTEM,
    user: buildSuggestTestPromptUser({
      agentName: args.agentName,
      currentPrompt: args.currentPrompt,
      failures: args.failures.slice(0, 40),
    }),
    schema: suggestedTestPromptSchema,
    maxOutputTokens: 12_000,
  })
  return {
    currentPrompt: args.currentPrompt,
    revisedPrompt: result.data.revisedPrompt,
    summary: result.data.summary,
  }
}
