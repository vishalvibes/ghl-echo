import { z } from 'zod'
import { criterionSchema } from './scorecard.js'
import {
  callerSentimentSchema,
  findingSchema,
  findingTypeSchema,
  segmentSchema,
  verdictSchema,
  criterionResultSchema,
} from './evaluation.js'
import { callDirectionSchema, callOutcomeSchema, turnSchema } from './transcript.js'
import { transcriptMetricsSchema } from './metrics.js'
import { callQualitySchema } from './quality.js'

/** Rolling window every dashboard read is scoped to. */
export const windowSchema = z.enum(['24h', '7d', '30d', '90d'])
export type AnalyticsWindow = z.infer<typeof windowSchema>

export const WINDOW_DAYS: Record<AnalyticsWindow, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

/** Shell-level state that decides whether analytics routes can be shown. */
export const integrationStatusSchema = z.object({
  ghlLocationId: z.string(),
  oauthConnected: z.boolean(),
  hasCalls: z.boolean(),
})
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>

// --- Overview ---------------------------------------------------------------

export const kpiSchema = z.object({
  calls: z.number().int(),
  /** Calls that received a verdict from an explicitly configured scorecard. */
  evaluatedCalls: z.number().int(),
  passRate: z.number().min(0).max(1),
  failRate: z.number().min(0).max(1),
  openActions: z.number().int(),
  avgDurationSec: z.number().int(),
  /** Change vs the immediately preceding window of the same length. */
  passRateDelta: z.number(),
})
export type Kpis = z.infer<typeof kpiSchema>

export const trendPointSchema = z.object({
  date: z.string(),
  calls: z.number().int(),
  passRate: z.number().min(0).max(1),
})
export type TrendPoint = z.infer<typeof trendPointSchema>

/** Running aggregates through each day in the selected window. */
export const callMetricTrendPointSchema = z.object({
  date: z.string(),
  calls: z.number().int(),
  cumulativeCalls: z.number().int(),
  avgTurns: z.number().nonnegative().nullable(),
  avgDurationSec: z.number().nullable(),
  agentTalkShare: z.number().min(0).max(1).nullable(),
  interruptionRate: z.number().min(0).max(1).nullable(),
  callerRepeatRate: z.number().min(0).max(1).nullable(),
  completionRate: z.number().min(0).max(1).nullable(),
  resolvedRate: z.number().min(0).max(1).nullable(),
  prematureHangupRate: z.number().min(0).max(1).nullable(),
  scriptAdherence: z.number().min(1).max(5).nullable(),
  comprehension: z.number().min(1).max(5).nullable(),
  tone: z.number().min(1).max(5).nullable(),
  nameCaptureRate: z.number().min(0).max(1).nullable(),
  emailCaptureRate: z.number().min(0).max(1).nullable(),
  phoneCaptureRate: z.number().min(0).max(1).nullable(),
  positiveSentimentRate: z.number().min(0).max(1).nullable(),
  neutralSentimentRate: z.number().min(0).max(1).nullable(),
  negativeSentimentRate: z.number().min(0).max(1).nullable(),
})
export type CallMetricTrendPoint = z.infer<typeof callMetricTrendPointSchema>

export const failureModeSchema = z.object({
  type: findingTypeSchema,
  label: z.string(),
  count: z.number().int(),
})
export type FailureMode = z.infer<typeof failureModeSchema>

export const agentSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  calls: z.number().int(),
  passRate: z.number().min(0).max(1),
  passRateDelta: z.number(),
  worstCriterion: z
    .object({ key: z.string(), label: z.string(), passRate: z.number() })
    .nullable(),
  openActions: z.number().int(),
  /** Recent per-day pass rates, oldest first. Feeds the sparkline. */
  sparkline: z.array(z.number()),
})
export type AgentSummary = z.infer<typeof agentSummarySchema>

/**
 * Cumulative read of the LLM quality pass across the window.
 *
 * Separate from `kpis` because it has a different denominator: KPIs count
 * every call, this counts only calls the quality pass actually ran on. Mixing
 * the two would quietly understate every average as coverage grows.
 */
export const overviewSchema = z.object({
  window: windowSchema,
  kpis: kpiSchema,
  trend: z.array(trendPointSchema),
  metricTrend: z.array(callMetricTrendPointSchema),
  failureModes: z.array(failureModeSchema),
  agents: z.array(agentSummarySchema),
})
export type Overview = z.infer<typeof overviewSchema>

// --- Agent detail -----------------------------------------------------------

export const criterionBreakdownSchema = z.object({
  key: z.string(),
  label: z.string(),
  weight: z.number().int(),
  /** Share of evaluated calls where this criterion was met. */
  passRate: z.number().min(0).max(1),
  delta: z.number(),
  evaluated: z.number().int(),
})
export type CriterionBreakdown = z.infer<typeof criterionBreakdownSchema>

export const agentDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  window: windowSchema,
  kpis: kpiSchema,
  scorecardVersion: z.number().int(),
  criteria: z.array(criterionBreakdownSchema),
  failureModes: z.array(failureModeSchema),
  trend: z.array(trendPointSchema),
})
export type AgentDetail = z.infer<typeof agentDetailSchema>

// --- Recommendations --------------------------------------------------------

export const recommendationItemSchema = z.object({
  rank: z.number().int().positive(),
  title: z.string().max(160),
  /** Why this is happening, grounded in the clustered findings. */
  diagnosis: z.string().max(1200),
  /** Concrete prompt/script edit the user can paste into their agent. */
  promptPatch: z.string().max(2000).nullable().default(null),
  /** How many calls in the window exhibit this pattern. */
  affectedCalls: z.number().int(),
  /** Call ids the user can open to verify the claim. Never empty. */
  evidenceCallIds: z.array(z.uuid()).min(1),
  expectedImpact: z.enum(['low', 'medium', 'high']),
})
export type RecommendationItem = z.infer<typeof recommendationItemSchema>

export const recommendationsSchema = z.object({
  agentId: z.uuid(),
  window: windowSchema,
  basedOnCalls: z.number().int(),
  generatedAt: z.iso.datetime(),
  /** True when served from cache rather than freshly generated. */
  cached: z.boolean(),
  items: z.array(recommendationItemSchema),
})
export type Recommendations = z.infer<typeof recommendationsSchema>

// --- Calls ------------------------------------------------------------------

export const callListItemSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  agentName: z.string(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  channel: z.enum(['web', 'phone']),
  direction: callDirectionSchema,
  outcome: callOutcomeSchema,
  isTestCall: z.boolean(),
  startedAt: z.iso.datetime(),
  durationSec: z.number().int(),
  verdict: verdictSchema.nullable(),
  overallScore: z.number().int().nullable(),
  findingCount: z.number().int(),
  actionCount: z.number().int(),
})
export type CallListItem = z.infer<typeof callListItemSchema>

export const callListSchema = z.object({
  items: z.array(callListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
export type CallList = z.infer<typeof callListSchema>

/** Why a call has no evaluation — the UI must not guess between these. */
export const ingestStatusSchema = z.enum(['pending', 'evaluated', 'skipped', 'failed'])
export type IngestStatus = z.infer<typeof ingestStatusSchema>

export const callDetailSchema = callListItemSchema.extend({
  transcript: z.array(turnSchema),
  /**
   * Deterministic transcript metrics. Independent of the judge, so they are
   * present even on unscored calls. Null only for rows ingested before the
   * metrics pass existed.
   */
  metrics: transcriptMetricsSchema.nullable(),
  /**
   * The model's read of the call — outcome, script adherence, comprehension,
   * tone, missed opportunities. Null when the agent is not configured, the
   * LLM is off, or the transcript was empty.
   */
  quality: callQualitySchema.nullable(),
  ingestStatus: ingestStatusSchema,
  ingestError: z.string().nullable(),
  isMock: z.boolean(),
  evaluation: z
    .object({
      scorecardVersion: z.number().int(),
      overallScore: z.number().int(),
      verdict: verdictSchema,
      summary: z.string(),
      callerSentiment: callerSentimentSchema,
      model: z.string(),
      createdAt: z.iso.datetime(),
      criteria: z.array(criterionResultSchema.extend({ label: z.string(), weight: z.number().int() })),
      findings: z.array(findingSchema.extend({ id: z.uuid() })),
      segments: z.array(segmentSchema.extend({ id: z.uuid(), status: z.enum(['open', 'done', 'dismissed']) })),
    })
    .nullable(),
})
export type CallDetail = z.infer<typeof callDetailSchema>

// --- Action queue -----------------------------------------------------------

export const actionStatusSchema = z.enum(['open', 'done', 'dismissed'])
export type ActionStatus = z.infer<typeof actionStatusSchema>

export const actionItemSchema = segmentSchema.extend({
  id: z.uuid(),
  callId: z.uuid(),
  agentName: z.string(),
  contactPhone: z.string().nullable(),
  startedAt: z.iso.datetime(),
  severity: z.enum(['low', 'medium', 'high']),
  status: actionStatusSchema,
})
export type ActionItem = z.infer<typeof actionItemSchema>

// --- Scorecard authoring ----------------------------------------------------

/** Result of dry-running a draft scorecard against recent calls. */
export const scorecardTestResultSchema = z.object({
  callId: z.uuid(),
  startedAt: z.iso.datetime(),
  contactPhone: z.string().nullable(),
  overallScore: z.number().int(),
  verdict: verdictSchema,
  criteria: z.array(criterionResultSchema),
})
export type ScorecardTestResult = z.infer<typeof scorecardTestResultSchema>

/** Criteria proposed by the LLM from the agent's own prompt. */
export const suggestedCriteriaSchema = z.object({
  criteria: z.array(criterionSchema),
  reasoning: z.string(),
})
export type SuggestedCriteria = z.infer<typeof suggestedCriteriaSchema>

// --- Agent synthetic testing ------------------------------------------------

export const agentGoalsSchema = z.object({
  goals: z.array(z.string().min(1).max(500)).max(20),
})
export type AgentGoals = z.infer<typeof agentGoalsSchema>

export const proposedEdgeCasesSchema = z.object({
  edgeCases: z.array(z.string().min(1).max(300)).min(1).max(12),
})
export type ProposedEdgeCases = z.infer<typeof proposedEdgeCasesSchema>

export const confirmEdgeCasesSchema = z.object({
  edgeCases: z.array(z.string().min(1).max(300)).min(1).max(12),
})
export type ConfirmEdgeCases = z.infer<typeof confirmEdgeCasesSchema>

/** One expanded test produced when the user confirms an edge case. */
export const testCriterionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'key must be lower_snake_case'),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
})
export type TestCriterion = z.infer<typeof testCriterionSchema>

export const expandedTestCaseSchema = z.object({
  scenario: z.array(z.string().min(1).max(400)).min(2).max(12),
  criteria: z.array(testCriterionSchema).min(1).max(10),
  transcripts: z.array(z.array(turnSchema).min(2).max(80)).min(2).max(4),
})
export type ExpandedTestCase = z.infer<typeof expandedTestCaseSchema>

export const testCaseTranscriptResultSchema = z.object({
  transcriptIndex: z.number().int().nonnegative(),
  criteria: z.array(
    z.object({
      key: z.string(),
      met: z.boolean(),
      rationale: z.string(),
    }),
  ),
  feedback: z.string().nullable(),
})
export type TestCaseTranscriptResult = z.infer<typeof testCaseTranscriptResultSchema>

export const testCaseSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  edgeCase: z.string(),
  scenario: z.array(z.string()),
  criteria: z.array(testCriterionSchema),
  transcripts: z.array(z.array(turnSchema)),
  results: z.array(testCaseTranscriptResultSchema).nullable(),
  lastRunAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type TestCase = z.infer<typeof testCaseSchema>

export const testCaseListSchema = z.object({
  goals: z.array(z.string()),
  prompt: z.string().nullable(),
  testCases: z.array(testCaseSchema),
})
export type TestCaseList = z.infer<typeof testCaseListSchema>

/** LLM-revised agent prompt grounded in failed synthetic tests. */
export const suggestedTestPromptSchema = z.object({
  summary: z.string().min(1).max(2000),
  revisedPrompt: z.string().min(1).max(100_000),
})
export type SuggestedTestPrompt = z.infer<typeof suggestedTestPromptSchema>

export const suggestTestPromptResponseSchema = z.object({
  currentPrompt: z.string(),
  revisedPrompt: z.string(),
  summary: z.string(),
})
export type SuggestTestPromptResponse = z.infer<typeof suggestTestPromptResponseSchema>

export const agentPromptSchema = z.object({
  prompt: z.string().min(1).max(100_000),
})
export type AgentPromptBody = z.infer<typeof agentPromptSchema>
