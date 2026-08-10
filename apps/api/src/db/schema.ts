import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type {
  AgentTestingJob,
  CallQuality,
  Criterion,
  TranscriptMetrics,
  Turn,
} from '@copilot/shared'
import { defaultAgentPrompt } from '../lib/default-prompt.js'

/** Objective checklist item for synthetic agent tests (UI table). */
export type TestCriterion = {
  key: string
  label: string
  description: string
}

/** Per-mock scoring from the last test run. */
export type TestCaseTranscriptResult = {
  transcriptIndex: number
  criteria: Array<{ key: string; met: boolean; rationale: string }>
  feedback: string | null
}

/**
 * Every row in this schema is scoped to a HighLevel location (sub-account).
 * `locationId` is the tenant key and is present on every queryable table so a
 * missing join can never leak one customer's calls into another's dashboard.
 */

export const verdictEnum = pgEnum('verdict', ['pass', 'partial', 'fail'])
export const severityEnum = pgEnum('severity', ['low', 'medium', 'high'])
export const actionStatusEnum = pgEnum('action_status', ['open', 'done', 'dismissed'])
export const callDirectionEnum = pgEnum('call_direction', ['inbound', 'outbound'])
export const callOutcomeEnum = pgEnum('call_outcome', [
  'completed',
  'no_answer',
  'voicemail',
  'busy',
  'failed',
])
export const ingestStatusEnum = pgEnum('ingest_status', [
  'pending',
  'evaluated',
  'skipped',
  'failed',
])
export const webhookEventStatusEnum = pgEnum('webhook_event_status', [
  'pending',
  'processing',
  'waiting_authorization',
  'processed',
  'failed',
])

// --- Tenancy ----------------------------------------------------------------

/** One installed copy of the app, plus its OAuth tokens. */
export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ghlLocationId: varchar('ghl_location_id', { length: 64 }).notNull().unique(),
  ghlCompanyId: varchar('ghl_company_id', { length: 64 }),
  name: text('name').notNull().default('Unnamed location'),
  /** Encrypted at rest by `ghl/tokens.ts` — never written in plaintext. */
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  scopes: text('scopes'),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
})

/**
 * Durable inbox for signed provider webhooks. Persisting before sending an
 * Inngest event closes the delivery gap between the HTTP acknowledgement and
 * asynchronous processing; the recovery sweep can resend any stranded row.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    providerEventId: varchar('provider_event_id', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: webhookEventStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('webhook_events_delivery_idx').on(
      t.locationId,
      t.eventType,
      t.providerEventId,
    ),
    index('webhook_events_status_received_idx').on(t.status, t.receivedAt),
    index('webhook_events_location_provider_idx').on(
      t.locationId,
      t.providerEventId,
      t.receivedAt.desc(),
    ),
    index('webhook_events_location_status_idx').on(
      t.locationId,
      t.status,
      t.receivedAt,
    ),
    index('webhook_events_processing_updated_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} = 'processing'`),
  ],
)

// --- Agents & scorecards ----------------------------------------------------

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    ghlAgentId: varchar('ghl_agent_id', { length: 64 }).notNull(),
    name: text('name').notNull(),
    /**
     * Canonical agent prompt used for synthetic testing and generation.
     * The database default is the final safety net for every insertion path;
     * application flows also set it explicitly for clarity.
     */
    prompt: text('prompt').notNull().default(defaultAgentPrompt()),
    /** User-authored testing goals that drive edge-case generation. */
    goals: jsonb('goals').$type<string[]>().notNull().default([]),
    /**
     * One active (or last terminal) background testing job: confirm / run /
     * suggest. Cleared via dismiss or overwritten on the next enqueue.
     */
    testingJob: jsonb('testing_job').$type<AgentTestingJob | null>(),
    /**
     * Copy of the agent's system prompt at last sync. The recommendation
     * engine diffs against this, so it must be the text the calls actually
     * ran under — not whatever the prompt says today.
     */
    promptSnapshot: text('prompt_snapshot'),
    promptSyncedAt: timestamp('prompt_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agents_location_ghl_agent_idx').on(t.locationId, t.ghlAgentId)],
)

/**
 * Versioned, append-only. Editing criteria inserts a new version rather than
 * mutating the old one, so historical evaluations stay interpretable.
 */
export const scorecards = pgTable(
  'scorecards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    passThreshold: integer('pass_threshold').notNull().default(70),
    partialThreshold: integer('partial_threshold').notNull().default(40),
    criteria: jsonb('criteria').$type<Criterion[]>().notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('scorecards_agent_version_idx').on(t.agentId, t.version),
    index('scorecards_active_idx').on(t.agentId, t.isActive),
  ],
)

/**
 * Synthetic agent tests. One row per confirmed edge case: scenario outline,
 * objective criteria, and multiple mock past-call transcripts for scoring.
 */
export const testCases = pgTable(
  'test_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** Short one-line failure / situation label. */
    edgeCase: text('edge_case').notNull(),
    /** Step-by-step situation outline (not the score rubric). */
    scenario: jsonb('scenario').$type<string[]>().notNull(),
    /** Objective criteria for the UI table and judge. */
    criteria: jsonb('criteria').$type<TestCriterion[]>().notNull(),
    /** Multiple mock past-call transcripts (caller + agent turns). */
    transcripts: jsonb('transcripts').$type<Turn[][]>().notNull(),
    /** Last run: score matrix per mock transcript. */
    results: jsonb('results').$type<TestCaseTranscriptResult[]>(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('test_cases_agent_created_idx').on(t.agentId, t.createdAt),
    index('test_cases_location_agent_idx').on(t.locationId, t.agentId),
  ],
)

// --- Calls ------------------------------------------------------------------

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** Dedupe key — webhooks are at-least-once, so ingest must be idempotent. */
    ghlCallId: varchar('ghl_call_id', { length: 128 }).notNull(),
    contactName: text('contact_name'),
    contactPhone: varchar('contact_phone', { length: 32 }),
    direction: callDirectionEnum('direction').notNull(),
    outcome: callOutcomeEnum('outcome').notNull().default('completed'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationSec: integer('duration_sec').notNull().default(0),
    transcript: jsonb('transcript').$type<Turn[]>().notNull(),
    /**
     * Deterministic conversation metrics (talk ratio, interruptions,
     * repetition). Computed from `transcript` at ingest, so they exist even
     * when the judge is disabled. Nullable for rows written before the
     * metrics pass existed; recomputable at any time from the transcript.
     */
    metrics: jsonb('metrics').$type<TranscriptMetrics>(),
    /** Stored projections used by aggregate queries; never written by ingest. */
    agentTalkRatio: real('agent_talk_ratio').generatedAlwaysAs(
      sql`(("metrics" ->> 'talkRatio')::real)`,
    ),
    interruptionRate: real('interruption_rate').generatedAlwaysAs(
      sql`(("metrics" #>> '{endpointing,interruptionRate}')::real)`,
    ),
    callerRepeatRate: real('caller_repeat_rate').generatedAlwaysAs(
      sql`(("metrics" #>> '{comprehension,callerRepeatRate}')::real)`,
    ),
    /**
     * Model-assessed quality: outcome, script adherence, comprehension, tone,
     * information captured, missed opportunities. One LLM pass, one JSON blob.
     *
     * Lives on the call rather than the evaluation because the assessment
     * shape is scorecard-independent. It only runs after the agent is set up;
     * null means the agent is not configured, the LLM is off, the transcript
     * is empty, or the row predates the column.
     */
    quality: jsonb('quality').$type<CallQuality>(),
    /** Stored quality projections. Null means the quality pass has not run. */
    callCompleted: boolean('call_completed').generatedAlwaysAs(
      sql`(("quality" ->> 'callCompleted')::boolean)`,
    ),
    taskOutcome: varchar('task_outcome', { length: 32 }).generatedAlwaysAs(
      sql`("quality" #>> '{outcome,result}')`,
    ),
    scriptAdherenceScore: integer('script_adherence_score').generatedAlwaysAs(
      sql`(("quality" #>> '{scriptAdherence,score}')::integer)`,
    ),
    comprehensionScore: integer('comprehension_score').generatedAlwaysAs(
      sql`(("quality" #>> '{comprehension,score}')::integer)`,
    ),
    toneScore: integer('tone_score').generatedAlwaysAs(
      sql`(("quality" #>> '{tone,score}')::integer)`,
    ),
    callerSentiment: varchar('caller_sentiment', { length: 16 }).generatedAlwaysAs(
      sql`("quality" ->> 'callerSentiment')`,
    ),
    prematureHangup: boolean('premature_hangup').generatedAlwaysAs(
      sql`(("quality" ->> 'prematureHangup')::boolean)`,
    ),
    capturedName: boolean('captured_name').generatedAlwaysAs(
      sql`(("quality" #>> '{informationCaptured,name}')::boolean)`,
    ),
    capturedEmail: boolean('captured_email').generatedAlwaysAs(
      sql`(("quality" #>> '{informationCaptured,email}')::boolean)`,
    ),
    capturedPhone: boolean('captured_phone').generatedAlwaysAs(
      sql`(("quality" #>> '{informationCaptured,phone}')::boolean)`,
    ),
    ingestStatus: ingestStatusEnum('ingest_status').notNull().default('pending'),
    ingestError: text('ingest_error'),
    /** True for synthetic calls loaded from fixtures. Surfaced in the UI. */
    isMock: boolean('is_mock').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('calls_location_ghl_call_idx').on(t.locationId, t.ghlCallId),
    index('calls_agent_started_idx').on(t.agentId, t.startedAt.desc()),
    index('calls_location_started_idx').on(t.locationId, t.startedAt.desc()),
    index('calls_pending_idx')
      .on(t.id)
      .where(sql`${t.ingestStatus} = 'pending'`),
  ],
)

// --- Evaluations ------------------------------------------------------------

export const evaluations = pgTable(
  'evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    scorecardId: uuid('scorecard_id')
      .notNull()
      .references(() => scorecards.id),
    scorecardVersion: integer('scorecard_version').notNull(),
    /** Weighted 0..100, computed in `scoreCall`, never taken from the model. */
    overallScore: integer('overall_score').notNull(),
    verdict: verdictEnum('verdict').notNull(),
    summary: text('summary').notNull(),
    callerSentiment: varchar('caller_sentiment', { length: 16 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    latencyMs: integer('latency_ms').notNull().default(0),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    /** Criteria the judge failed to return — a model-quality signal. */
    missingKeys: jsonb('missing_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live evaluation per call per scorecard version; re-scoring under a
    // new version adds a row instead of destroying the old judgement.
    uniqueIndex('evaluations_call_version_idx').on(t.callId, t.scorecardVersion),
    index('evaluations_agent_created_idx').on(t.agentId, t.createdAt.desc()),
  ],
)

export const criterionResults = pgTable(
  'criterion_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => evaluations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    criterionKey: varchar('criterion_key', { length: 64 }).notNull(),
    met: boolean('met').notNull(),
    value: text('value'),
    confidence: real('confidence').notNull().default(0),
    evidenceTurnIds: jsonb('evidence_turn_ids')
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    rationale: text('rationale').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('criterion_results_eval_key_idx').on(t.evaluationId, t.criterionKey),
    // Powers the per-criterion pass-rate breakdown without touching evaluations.
    index('criterion_results_agent_key_idx').on(t.agentId, t.criterionKey, t.createdAt.desc()),
  ],
)

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => evaluations.id, { onDelete: 'cascade' }),
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 48 }).notNull(),
    severity: severityEnum('severity').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    quote: text('quote'),
    turnIds: jsonb('turn_ids').$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('findings_agent_type_idx').on(t.agentId, t.type, t.createdAt.desc()),
    index('findings_location_created_idx').on(t.locationId, t.createdAt.desc(), t.type),
    index('findings_call_idx').on(t.callId, t.createdAt.desc()),
    index('findings_evaluation_idx').on(t.evaluationId),
  ],
)

/** "Use Actions": spans of a call that need a human. The daily work queue. */
export const callActions = pgTable(
  'call_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => evaluations.id, { onDelete: 'cascade' }),
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    turnStart: integer('turn_start').notNull(),
    turnEnd: integer('turn_end').notNull(),
    actionType: varchar('action_type', { length: 48 }).notNull(),
    reason: text('reason').notNull(),
    severity: severityEnum('severity').notNull().default('medium'),
    status: actionStatusEnum('status').notNull().default('open'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('call_actions_location_status_idx').on(t.locationId, t.status, t.createdAt.desc()),
    index('call_actions_call_status_idx').on(t.callId, t.status),
    index('call_actions_evaluation_idx').on(t.evaluationId),
  ],
)

// --- Recommendations --------------------------------------------------------

/** Cached LLM output. Regenerated when the window or evidence set changes. */
export const recommendations = pgTable(
  'recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    window: varchar('window', { length: 8 }).notNull(),
    /** Hash of the evidence call ids — a changed set invalidates the cache. */
    evidenceHash: varchar('evidence_hash', { length: 64 }).notNull(),
    basedOnCalls: integer('based_on_calls').notNull(),
    items: jsonb('items').$type<unknown[]>().notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('recommendations_agent_window_hash_idx').on(t.agentId, t.window, t.evidenceHash)],
)

// --- Relations --------------------------------------------------------------

export const locationsRelations = relations(locations, ({ many }) => ({
  agents: many(agents),
  calls: many(calls),
  webhookEvents: many(webhookEvents),
}))

export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  location: one(locations, {
    fields: [webhookEvents.locationId],
    references: [locations.id],
  }),
}))

export const agentsRelations = relations(agents, ({ one, many }) => ({
  location: one(locations, { fields: [agents.locationId], references: [locations.id] }),
  scorecards: many(scorecards),
  testCases: many(testCases),
  calls: many(calls),
}))

export const testCasesRelations = relations(testCases, ({ one }) => ({
  location: one(locations, { fields: [testCases.locationId], references: [locations.id] }),
  agent: one(agents, { fields: [testCases.agentId], references: [agents.id] }),
}))

export const callsRelations = relations(calls, ({ one, many }) => ({
  agent: one(agents, { fields: [calls.agentId], references: [agents.id] }),
  evaluations: many(evaluations),
}))

export const evaluationsRelations = relations(evaluations, ({ one, many }) => ({
  call: one(calls, { fields: [evaluations.callId], references: [calls.id] }),
  agent: one(agents, { fields: [evaluations.agentId], references: [agents.id] }),
  criterionResults: many(criterionResults),
  findings: many(findings),
  segments: many(callActions),
}))

export const criterionResultsRelations = relations(criterionResults, ({ one }) => ({
  evaluation: one(evaluations, {
    fields: [criterionResults.evaluationId],
    references: [evaluations.id],
  }),
}))

export const findingsRelations = relations(findings, ({ one }) => ({
  evaluation: one(evaluations, { fields: [findings.evaluationId], references: [evaluations.id] }),
  call: one(calls, { fields: [findings.callId], references: [calls.id] }),
}))

export const callActionsRelations = relations(callActions, ({ one }) => ({
  evaluation: one(evaluations, { fields: [callActions.evaluationId], references: [evaluations.id] }),
  call: one(calls, { fields: [callActions.callId], references: [calls.id] }),
}))

export type CallActionRow = typeof callActions.$inferSelect
export type CallActionInsert = typeof callActions.$inferInsert
export type CallRow = typeof calls.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type ScorecardRow = typeof scorecards.$inferSelect
export type TestCaseRow = typeof testCases.$inferSelect
export type LocationRow = typeof locations.$inferSelect
export type EvaluationRow = typeof evaluations.$inferSelect
export type WebhookEventRow = typeof webhookEvents.$inferSelect
