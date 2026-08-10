import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm'
import {
  computeTranscriptMetrics,
  scorecardDraftSchema,
  suggestedCriteriaSchema,
  agentGoalsSchema,
  proposedEdgeCasesSchema,
  confirmEdgeCasesSchema,
  expandedTestCaseSchema,
  suggestedTestPromptSchema,
  agentPromptSchema,
  windowSchema,
  type CallDetail,
  type CallListItem,
  type Criterion,
  type Overview,
  type TestCase,
  type TestCriterion,
  type TestCaseTranscriptResult,
  type Turn,
} from '@copilot/shared'
import { db } from '../db/client.js'
import { DEMO_LOCATION_GHL_ID } from '../db/seed.js'
import {
  agents,
  calls,
  evaluations,
  findings,
  locations,
  scorecards,
  callActions,
  testCases,
} from '../db/schema.js'
import { env } from '../config/env.js'
import { EVENT_BACKFILL_REQUESTED, inngestClient } from '../clients/inngest.js'
import { syncAgentsForLocation } from './agent-sync.js'
import {
  getAgentMonitoringSnapshot,
  latestScorecardFor,
  saveAgentScorecard,
} from '../services/agent-monitoring.js'
import { getRecommendations } from '../insights/recommend.js'
import { requireSession } from '../lib/session.js'
import { completeStructured } from '../lib/llm.js'
import { SUGGEST_CRITERIA_SYSTEM_PROMPT } from '../scoring/prompts.js'
import {
  buildExpandTestCaseUserPrompt,
  buildProposeEdgeCasesUserPrompt,
  buildSuggestTestPromptUser,
  EXPAND_TEST_CASE_SYSTEM_PROMPT,
  PROPOSE_EDGE_CASES_SYSTEM_PROMPT,
  SUGGEST_TEST_PROMPT_SYSTEM,
} from '../scoring/test-case-prompts.js'
import { judgeCall, type JudgeResult } from '../scoring/judge.js'
import {
  computeAgentSummaries,
  computeCriterionBreakdown,
  computeFailureModes,
  computeKpis,
  computeMetricTrend,
  computeTrend,
  windowStart,
} from './analytics.js'

const windowQuery = z.object({ window: windowSchema.default('7d') })
const overviewQuery = windowQuery.extend({ agentId: z.uuid().optional() })
const idParam = z.object({ id: z.uuid() })

/** Fixed verdict cutoffs for synthetic tests — not stored per edge case. */
const TEST_CASE_PASS_THRESHOLD = 70
const TEST_CASE_PARTIAL_THRESHOLD = 40

function serializeTestCase(row: typeof testCases.$inferSelect): TestCase {
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

/** Map table criteria into the judge's Criterion shape. */
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

/**
 * One objective line on what to fix. Pass → null. Otherwise prefer the top
 * finding title, then the first unmet criterion rationale.
 */
function improvementFeedback(judged: JudgeResult): string | null {
  if (judged.verdict === 'pass') return null
  const finding = judged.output.findings[0]
  if (finding?.title?.trim()) return finding.title.trim().slice(0, 200)
  const unmet = judged.output.criteria.find((c) => !c.met)
  if (unmet?.rationale?.trim()) return unmet.rationale.trim().slice(0, 200)
  return 'Agent missed one or more test criteria.'
}

/** Force contiguous 0-based ids so judge evidence citations stay valid. */
function normalizeTranscript(turns: Turn[]): Turn[] {
  return turns.map((turn, id) => ({ ...turn, id }))
}

export const apiRoutes: FastifyPluginAsyncZod = async (app) => {
  // Every /api route requires an iframe session; tenant comes from the cookie.
  app.addHook('preHandler', requireSession)

  app.get('/api/integration', async (request) => {
    const [location, callTotal] = await Promise.all([
      db.query.locations.findFirst({
        where: eq(locations.id, request.session.locationId),
        columns: {
          ghlLocationId: true,
          accessToken: true,
          refreshToken: true,
          uninstalledAt: true,
        },
      }),
      db
        .select({ value: count() })
        .from(calls)
        .where(eq(calls.locationId, request.session.locationId))
        .then((rows) => rows[0]?.value ?? 0),
    ])

    const fixtureLocation =
      env.USE_FIXTURES && location?.ghlLocationId === DEMO_LOCATION_GHL_ID

    return {
      ghlLocationId: location?.ghlLocationId ?? request.session.ghlLocationId,
      oauthConnected:
        fixtureLocation ||
        Boolean(location?.accessToken && location.refreshToken && !location.uninstalledAt),
      hasCalls: callTotal > 0,
    }
  })

  // --- Overview -------------------------------------------------------------

  app.get('/api/overview', { schema: { querystring: overviewQuery } }, async (request): Promise<Overview> => {
    const { window, agentId } = request.query
    // The agent table stays unfiltered — it is the picker's own source, and
    // filtering it to the selected agent would leave no way to switch back.
    const scope = { locationId: request.session.locationId, ...(agentId ? { agentId } : {}) }
    const [kpis, trend, metricTrend, failureModes, agentSummaries] = await Promise.all([
      computeKpis(scope, window),
      computeTrend(scope, window),
      computeMetricTrend(scope, window),
      computeFailureModes(scope, window).catch((error) => {
        // Failure modes are a supporting view. A malformed legacy quality row
        // or a partially migrated projection must not take down every KPI and
        // chart on the overview page.
        request.log.error({ err: error }, 'failure-mode aggregation failed')
        return []
      }),
      computeAgentSummaries(scope.locationId, window),
    ])
    return { window, kpis, trend, metricTrend, failureModes, agents: agentSummaries }
  })

  // --- Agents ---------------------------------------------------------------

  app.get('/api/agents', async (request) => {
    const rows = await db.query.agents.findMany({
      where: eq(agents.locationId, request.session.locationId),
      orderBy: (a, { asc }) => [asc(a.name)],
      columns: { id: true, name: true, ghlAgentId: true, promptSyncedAt: true },
    })
    return {
      agents: await Promise.all(
        rows.map(async (agent) => {
          const monitoring = await getAgentMonitoringSnapshot(agent.id)
          return {
            ...agent,
            configured: monitoring.configured,
            processingCalls: monitoring.processingCalls,
            scorecardVersion: monitoring.scorecard?.version ?? 0,
            criteriaCount: monitoring.scorecard?.criteria.filter((criterion) => criterion.enabled).length ?? 0,
          }
        }),
      ),
    }
  })

  /**
   * Create an agent by hand.
   *
   * Normally agents mirror the location's Voice AI agents (`/api/agents/sync`).
   * HighLevel refuses to provision LC Phone on marketplace sandbox companies
   * ("Twilio master account has disabled the creation of sandbox SubAccounts"),
   * so a sandbox can hold no Voice AI agent to mirror. This route lets the
   * pipeline be exercised against a hand-authored prompt instead — the prompt
   * is what scorecard suggestion and recommendations actually read.
   *
   * Manually created agents carry a `manual-` id prefix so a later sync can
   * never collide with them.
   */
  app.post(
    '/api/agents',
    {
      schema: {
        body: z.object({
          name: z.string().min(1).max(120),
          prompt: z.string().min(1).optional(),
          ghlAgentId: z.string().min(1).max(64).optional(),
        }),
      },
    },
    async (request, reply) => {
      const ghlAgentId = request.body.ghlAgentId ?? `manual-${randomUUID().slice(0, 8)}`
      const existing = await db.query.agents.findFirst({
        where: and(
          eq(agents.locationId, request.session.locationId),
          eq(agents.ghlAgentId, ghlAgentId),
        ),
        columns: { id: true },
      })
      if (existing) return reply.code(409).send({ error: 'agent already exists', agentId: existing.id })

      const [created] = await db
        .insert(agents)
        .values({
          locationId: request.session.locationId,
          ghlAgentId,
          name: request.body.name,
          promptSnapshot: request.body.prompt ?? null,
          promptSyncedAt: request.body.prompt ? new Date() : null,
        })
        .returning()
      return reply.code(201).send(created)
    },
  )

  /**
   * Re-mirror agents from HighLevel on demand. Install does this once; without
   * this route a prompt edited in GHL never reaches `promptSnapshot`, and the
   * recommendations would diff against stale text.
   */
  app.post('/api/agents/sync', async (request, reply) => {
    const location = await db.query.locations.findFirst({
      where: eq(locations.id, request.session.locationId),
    })
    if (!location) return reply.code(404).send({ error: 'location not found' })
    try {
      return await syncAgentsForLocation(location)
    } catch (error) {
      request.log.error({ err: error }, 'manual agent sync failed')
      return reply.code(502).send({ error: 'ghl sync failed', detail: (error as Error).message })
    }
  })

  app.get(
    '/api/agents/:id',
    { schema: { params: idParam, querystring: windowQuery } },
    async (request, reply) => {
      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
      })
      if (!agent) return reply.code(404).send({ error: 'agent not found' })

      const { window } = request.query
      const scope = { locationId: request.session.locationId, agentId: agent.id }
      const [kpis, trend, failureModes, breakdown, monitoring] = await Promise.all([
        computeKpis(scope, window),
        computeTrend(scope, window),
        computeFailureModes(scope, window),
        computeCriterionBreakdown(agent.id, window),
        getAgentMonitoringSnapshot(agent.id),
      ])

      const scorecard = monitoring.scorecard
      const meta = new Map(scorecard?.criteria.map((c) => [c.key, c]) ?? [])
      return {
        id: agent.id,
        name: agent.name,
        window,
        kpis,
        scorecardVersion: scorecard?.version ?? 0,
        promptSnapshot: agent.promptSnapshot,
        criteria: breakdown
          .map((b) => ({
            ...b,
            label: meta.get(b.key)?.label ?? b.key,
            weight: meta.get(b.key)?.weight ?? 1,
          }))
          .sort((a, b) => a.passRate - b.passRate),
        failureModes,
        trend,
      }
    },
  )

  app.get(
    '/api/agents/:id/recommendations',
    {
      schema: {
        params: idParam,
        querystring: windowQuery.extend({ force: z.enum(['true', 'false']).default('false') }),
      },
    },
    async (request, reply) => {
      try {
        return await getRecommendations(
          request.session.locationId,
          request.params.id,
          request.query.window,
          { force: request.query.force === 'true' },
        )
      } catch (error) {
        if ((error as { code?: string }).code === 'LLM_DISABLED') {
          return reply.code(503).send({ error: 'llm_disabled' })
        }
        throw error
      }
    },
  )

  // --- Calls ----------------------------------------------------------------

  app.get(
    '/api/calls',
    {
      schema: {
        querystring: windowQuery.extend({
          agentId: z.uuid().optional(),
          verdict: z.enum(['pass', 'partial', 'fail']).optional(),
          needsAction: z.enum(['true', 'false']).optional(),
          search: z.string().max(200).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(25),
        }),
      },
    },
    async (request) => {
      const q = request.query
      const since = windowStart(q.window)
      const conditions = [eq(calls.locationId, request.session.locationId), gte(calls.startedAt, since)]
      if (q.agentId) conditions.push(eq(calls.agentId, q.agentId))
      if (q.search) {
        conditions.push(
          or(
            ilike(calls.contactName, `%${q.search}%`),
            ilike(calls.contactPhone, `%${q.search}%`),
            sql`${calls.transcript}::text ilike ${'%' + q.search + '%'}`,
          )!,
        )
      }
      if (q.verdict) conditions.push(eq(evaluations.verdict, q.verdict))
      if (q.needsAction === 'true') {
        conditions.push(
          sql`exists (select 1 from ${callActions} a where a.call_id = ${calls.id} and a.status = 'open')`,
        )
      }

      const base = db
        .select({
          id: calls.id,
          agentId: calls.agentId,
          agentName: agents.name,
          contactName: calls.contactName,
          contactPhone: calls.contactPhone,
          channel: sql<'web' | 'phone'>`case when ${calls.contactPhone} is null then 'web' else 'phone' end`,
          direction: calls.direction,
          outcome: calls.outcome,
          isTestCall: sql<boolean>`${calls.contactPhone} is null`,
          startedAt: calls.startedAt,
          durationSec: calls.durationSec,
          verdict: evaluations.verdict,
          overallScore: evaluations.overallScore,
          findingCount: sql<number>`(select count(*) from ${findings} f where f.call_id = ${calls.id})`,
          actionCount: sql<number>`(select count(*) from ${callActions} a where a.call_id = ${calls.id} and a.status = 'open')`,
        })
        .from(calls)
        .innerJoin(agents, eq(calls.agentId, agents.id))
        .leftJoin(evaluations, eq(evaluations.callId, calls.id))
        .where(and(...conditions))

      const [items, totalRows] = await Promise.all([
        base
          .orderBy(desc(calls.startedAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: count() })
          .from(calls)
          .leftJoin(evaluations, eq(evaluations.callId, calls.id))
          .where(and(...conditions)),
      ])

      const mapped: CallListItem[] = items.map((row) => ({
        ...row,
        startedAt: row.startedAt.toISOString(),
        findingCount: Number(row.findingCount),
        actionCount: Number(row.actionCount),
      }))
      return { items: mapped, total: totalRows[0]?.n ?? 0, page: q.page, pageSize: q.pageSize }
    },
  )

  app.get('/api/calls/:id', { schema: { params: idParam } }, async (request, reply) => {
    const call = await db.query.calls.findFirst({
      where: and(eq(calls.id, request.params.id), eq(calls.locationId, request.session.locationId)),
      with: { agent: true },
    })
    if (!call) return reply.code(404).send({ error: 'call not found' })

    const evaluation = await db.query.evaluations.findFirst({
      where: eq(evaluations.callId, call.id),
      orderBy: (e, { desc: descOp }) => [descOp(e.scorecardVersion)],
      with: { criterionResults: true, findings: true, segments: true },
    })

    const scorecard = evaluation
      ? await db.query.scorecards.findFirst({
          where: (sc, { eq: eqOp }) => eqOp(sc.id, evaluation.scorecardId),
        })
      : null
    const meta = new Map(scorecard?.criteria.map((c) => [c.key, c]) ?? [])

    const detail: CallDetail = {
      id: call.id,
      agentId: call.agentId,
      agentName: call.agent.name,
      contactName: call.contactName,
      contactPhone: call.contactPhone,
      channel: call.contactPhone ? 'phone' : 'web',
      direction: call.direction,
      outcome: call.outcome,
      isTestCall: call.contactPhone === null,
      startedAt: call.startedAt.toISOString(),
      durationSec: call.durationSec,
      verdict: evaluation?.verdict ?? null,
      overallScore: evaluation?.overallScore ?? null,
      findingCount: evaluation?.findings.length ?? 0,
      actionCount: evaluation?.segments.filter((s) => s.status === 'open').length ?? 0,
      transcript: call.transcript,
      // Recomputed on read when the row predates the metrics column, so old
      // calls show mechanics too without needing a data migration.
      metrics: call.metrics ?? computeTranscriptMetrics(call.transcript),
      // Not recomputable on read — it costs a model call, so it is whatever
      // the ingest pipeline stored, or nothing.
      quality: call.quality ?? null,
      ingestStatus: call.ingestStatus,
      ingestError: call.ingestError,
      isMock: call.isMock,
      evaluation: evaluation
        ? {
            scorecardVersion: evaluation.scorecardVersion,
            overallScore: evaluation.overallScore,
            verdict: evaluation.verdict,
            summary: evaluation.summary,
            callerSentiment: evaluation.callerSentiment as 'positive' | 'neutral' | 'negative',
            model: evaluation.model,
            createdAt: evaluation.createdAt.toISOString(),
            criteria: evaluation.criterionResults.map((r) => ({
              key: r.criterionKey,
              met: r.met,
              value: r.value,
              confidence: r.confidence,
              evidenceTurnIds: r.evidenceTurnIds,
              rationale: r.rationale,
              label: meta.get(r.criterionKey)?.label ?? r.criterionKey,
              weight: meta.get(r.criterionKey)?.weight ?? 1,
            })),
            findings: evaluation.findings.map((f) => ({
              id: f.id,
              type: f.type as NonNullable<CallDetail['evaluation']>['findings'][number]['type'],
              severity: f.severity,
              title: f.title,
              detail: f.detail,
              quote: f.quote,
              turnIds: f.turnIds,
            })),
            segments: evaluation.segments.map((s) => ({
              id: s.id,
              turnStart: s.turnStart,
              turnEnd: s.turnEnd,
              actionType: s.actionType as NonNullable<
                CallDetail['evaluation']
              >['segments'][number]['actionType'],
              reason: s.reason,
              status: s.status,
            })),
          }
        : null,
    }
    return detail
  })

  // --- Action queue ---------------------------------------------------------

  app.get(
    '/api/actions',
    {
      schema: {
        querystring: z.object({
          status: z.enum(['open', 'done', 'dismissed']).default('open'),
          actionType: z.string().optional(),
        }),
      },
    },
    async (request) => {
      const conditions = [
        eq(callActions.locationId, request.session.locationId),
        eq(callActions.status, request.query.status),
      ]
      if (request.query.actionType) conditions.push(eq(callActions.actionType, request.query.actionType))

      const rows = await db
        .select({
          id: callActions.id,
          callId: callActions.callId,
          turnStart: callActions.turnStart,
          turnEnd: callActions.turnEnd,
          actionType: callActions.actionType,
          reason: callActions.reason,
          severity: callActions.severity,
          status: callActions.status,
          agentName: agents.name,
          contactPhone: calls.contactPhone,
          startedAt: calls.startedAt,
        })
        .from(callActions)
        .innerJoin(calls, eq(callActions.callId, calls.id))
        .innerJoin(agents, eq(callActions.agentId, agents.id))
        .where(and(...conditions))
        .orderBy(
          sql`case ${callActions.severity} when 'high' then 0 when 'medium' then 1 else 2 end`,
          desc(calls.startedAt),
        )
        .limit(200)

      return { items: rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString() })) }
    },
  )

  app.patch(
    '/api/actions/:id',
    {
      schema: {
        params: idParam,
        body: z.object({ status: z.enum(['open', 'done', 'dismissed']) }),
      },
    },
    async (request, reply) => {
      const [updated] = await db
        .update(callActions)
        .set({
          status: request.body.status,
          resolvedAt: request.body.status === 'open' ? null : new Date(),
        })
        .where(and(eq(callActions.id, request.params.id), eq(callActions.locationId, request.session.locationId)))
        .returning({ id: callActions.id, status: callActions.status })
      if (!updated) return reply.code(404).send({ error: 'action not found' })
      return updated
    },
  )

  /**
   * Re-run the call backfill for one agent. Install fires this once; re-running
   * it after a failed or partial backfill otherwise means hand-sending the
   * event through the Inngest Dev Server.
   */
  app.post('/api/agents/:id/backfill', { schema: { params: idParam } }, async (request, reply) => {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
      columns: { id: true },
    })
    if (!agent) return reply.code(404).send({ error: 'agent not found' })

    await inngestClient.send({
      name: EVENT_BACKFILL_REQUESTED,
      data: { locationId: request.session.locationId, agentId: agent.id },
    })
    return reply.code(202).send({ queued: true, agentId: agent.id })
  })

  // --- Scorecards -----------------------------------------------------------

  app.get('/api/agents/:id/scorecard', { schema: { params: idParam } }, async (request, reply) => {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
    })
    if (!agent) return reply.code(404).send({ error: 'agent not found' })
    const scorecard = await latestScorecardFor(agent.id)
    return { agentId: agent.id, agentName: agent.name, scorecard }
  })

  app.post(
    '/api/agents/:id/scorecard',
    { schema: { params: idParam, body: scorecardDraftSchema } },
    async (request, reply) => {
      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
      })
      if (!agent) return reply.code(404).send({ error: 'agent not found' })

      const result = await saveAgentScorecard({
        locationId: request.session.locationId,
        agentId: agent.id,
        draft: request.body,
      })
      return reply.code(201).send(result)
    },
  )

  /** LLM proposes criteria from the agent's own prompt. Nothing is saved. */
  app.post('/api/agents/:id/scorecard/suggest', { schema: { params: idParam } }, async (request, reply) => {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
    })
    if (!agent) return reply.code(404).send({ error: 'agent not found' })
    if (!agent.promptSnapshot) {
      return reply.code(409).send({ error: 'agent has no prompt snapshot to derive criteria from' })
    }
    try {
      const result = await completeStructured({
        system: SUGGEST_CRITERIA_SYSTEM_PROMPT,
        user: `AGENT NAME: ${agent.name}\n\nAGENT PROMPT:\n"""\n${agent.promptSnapshot}\n"""`,
        schema: suggestedCriteriaSchema,
      })
      return result.data
    } catch (error) {
      if ((error as { code?: string }).code === 'LLM_DISABLED') {
        return reply.code(503).send({ error: 'llm_disabled' })
      }
      throw error
    }
  })

  /** Dry-run a draft scorecard against recent calls. Nothing is persisted. */
  app.post(
    '/api/agents/:id/scorecard/test',
    {
      schema: {
        params: idParam,
        body: z.object({ draft: scorecardDraftSchema, sampleSize: z.number().int().min(1).max(5).default(3) }),
      },
    },
    async (request, reply) => {
      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
      })
      if (!agent) return reply.code(404).send({ error: 'agent not found' })

      const recent = await db.query.calls.findMany({
        where: and(eq(calls.agentId, agent.id), eq(calls.outcome, 'completed')),
        orderBy: (c, { desc: descOp }) => [descOp(c.startedAt)],
        limit: request.body.sampleSize,
      })
      if (recent.length === 0) return reply.code(409).send({ error: 'no calls to test against' })

      try {
        const results = await Promise.all(
          recent.map(async (call) => {
            const judged = await judgeCall({
              transcript: call.transcript,
              criteria: request.body.draft.criteria,
              passThreshold: request.body.draft.passThreshold,
              partialThreshold: request.body.draft.partialThreshold,
              context: {
                agentName: agent.name,
                agentPrompt: agent.promptSnapshot,
                direction: call.direction,
                durationSec: call.durationSec,
                outcome: call.outcome,
              },
            })
            return {
              callId: call.id,
              startedAt: call.startedAt.toISOString(),
              contactPhone: call.contactPhone,
              overallScore: judged.overallScore,
              verdict: judged.verdict,
              criteria: judged.output.criteria,
            }
          }),
        )
        return { results }
      } catch (error) {
        if ((error as { code?: string }).code === 'LLM_DISABLED') {
          return reply.code(503).send({ error: 'llm_disabled' })
        }
        throw error
      }
    },
  )

  // --- Synthetic agent testing ----------------------------------------------

  app.get('/api/agents/:id/test-cases', { schema: { params: idParam } }, async (request, reply) => {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
    })
    if (!agent) return reply.code(404).send({ error: 'agent not found' })

    const rows = await db.query.testCases.findMany({
      where: and(eq(testCases.agentId, agent.id), eq(testCases.locationId, request.session.locationId)),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    })

    return {
      goals: agent.goals ?? [],
      prompt: agent.prompt,
      testCases: rows.map(serializeTestCase),
    }
  })

  app.patch(
    '/api/agents/:id/goals',
    { schema: { params: idParam, body: agentGoalsSchema } },
    async (request, reply) => {
      const [updated] = await db
        .update(agents)
        .set({ goals: request.body.goals })
        .where(and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)))
        .returning({ id: agents.id, goals: agents.goals })
      if (!updated) return reply.code(404).send({ error: 'agent not found' })
      return updated
    },
  )

  app.post(
    '/api/agents/:id/test-cases/propose',
    { schema: { params: idParam, body: agentGoalsSchema } },
    async (request, reply) => {
      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
      })
      if (!agent) return reply.code(404).send({ error: 'agent not found' })

      const goals = request.body.goals.map((g) => g.trim()).filter(Boolean)
      if (goals.length === 0) return reply.code(409).send({ error: 'goals required' })
      if (!agent.prompt?.trim()) return reply.code(409).send({ error: 'agent has no prompt' })

      try {
        const result = await completeStructured({
          system: PROPOSE_EDGE_CASES_SYSTEM_PROMPT,
          user: buildProposeEdgeCasesUserPrompt({
            agentName: agent.name,
            agentPrompt: agent.prompt,
            goals,
          }),
          schema: proposedEdgeCasesSchema,
          maxOutputTokens: 2000,
        })
        return result.data
      } catch (error) {
        if ((error as { code?: string }).code === 'LLM_DISABLED') {
          return reply.code(503).send({ error: 'llm_disabled' })
        }
        throw error
      }
    },
  )

  app.post(
    '/api/agents/:id/test-cases/confirm',
    { schema: { params: idParam, body: confirmEdgeCasesSchema } },
    async (request, reply) => {
      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
      })
      if (!agent) return reply.code(404).send({ error: 'agent not found' })
      if (!agent.goals?.length) return reply.code(409).send({ error: 'agent has no goals' })
      if (!agent.prompt?.trim()) return reply.code(409).send({ error: 'agent has no prompt' })

      try {
        const expanded = await Promise.all(
          request.body.edgeCases.map(async (edgeCase) => {
            const result = await completeStructured({
              system: EXPAND_TEST_CASE_SYSTEM_PROMPT,
              user: buildExpandTestCaseUserPrompt({
                agentName: agent.name,
                agentPrompt: agent.prompt!,
                goals: agent.goals,
                edgeCase,
              }),
              schema: expandedTestCaseSchema,
              maxOutputTokens: 12_000,
            })
            const data = result.data
            return {
              edgeCase,
              scenario: data.scenario,
              criteria: data.criteria,
              transcripts: data.transcripts.map(normalizeTranscript),
            }
          }),
        )

        const saved = await db.transaction(async (tx) => {
          await tx
            .delete(testCases)
            .where(
              and(eq(testCases.agentId, agent.id), eq(testCases.locationId, request.session.locationId)),
            )
          if (expanded.length === 0) return []
          return tx
            .insert(testCases)
            .values(
              expanded.map((row) => ({
                locationId: request.session.locationId,
                agentId: agent.id,
                edgeCase: row.edgeCase,
                scenario: row.scenario,
                criteria: row.criteria,
                transcripts: row.transcripts,
                results: null,
              })),
            )
            .returning()
        })

        return { testCases: saved.map(serializeTestCase) }
      } catch (error) {
        if ((error as { code?: string }).code === 'LLM_DISABLED') {
          return reply.code(503).send({ error: 'llm_disabled' })
        }
        throw error
      }
    },
  )

  app.post(
    '/api/agents/:id/test-cases/run',
    { schema: { params: idParam, body: z.object({}).default({}) } },
    async (request, reply) => {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
    })
    if (!agent) return reply.code(404).send({ error: 'agent not found' })

    const rows = await db.query.testCases.findMany({
      where: and(eq(testCases.agentId, agent.id), eq(testCases.locationId, request.session.locationId)),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    })
    if (rows.length === 0) return reply.code(409).send({ error: 'no test cases to run' })

    try {
      const updated: TestCase[] = []
      for (const row of rows) {
        const judgeCriteria = toJudgeCriteria(row.criteria)
        const results: TestCaseTranscriptResult[] = []
        for (let transcriptIndex = 0; transcriptIndex < row.transcripts.length; transcriptIndex += 1) {
          const transcript = row.transcripts[transcriptIndex]!
          const judged = await judgeCall({
            transcript,
            criteria: judgeCriteria,
            passThreshold: TEST_CASE_PASS_THRESHOLD,
            partialThreshold: TEST_CASE_PARTIAL_THRESHOLD,
            context: {
              agentName: agent.name,
              agentPrompt: agent.prompt ?? agent.promptSnapshot,
              direction: 'inbound',
              durationSec: 0,
              outcome: 'completed',
            },
          })
          const byKey = new Map(judged.output.criteria.map((c) => [c.key, c]))
          results.push({
            transcriptIndex,
            criteria: row.criteria.map((c) => {
              const hit = byKey.get(c.key)
              return {
                key: c.key,
                met: hit?.met ?? false,
                rationale: hit?.rationale ?? 'No judgement returned for this criterion.',
              }
            }),
            feedback: improvementFeedback(judged),
          })
        }
        const [saved] = await db
          .update(testCases)
          .set({
            results,
            lastRunAt: new Date(),
          })
          .where(eq(testCases.id, row.id))
          .returning()
        if (saved) updated.push(serializeTestCase(saved))
      }
      return { testCases: updated }
    } catch (error) {
      if ((error as { code?: string }).code === 'LLM_DISABLED') {
        return reply.code(503).send({ error: 'llm_disabled' })
      }
      throw error
    }
  })

  app.post(
    '/api/agents/:id/test-cases/suggest-prompt',
    { schema: { params: idParam, body: z.object({}).default({}) } },
    async (request, reply) => {
      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)),
      })
      if (!agent) return reply.code(404).send({ error: 'agent not found' })
      if (!agent.prompt?.trim()) return reply.code(409).send({ error: 'agent has no prompt' })

      const rows = await db.query.testCases.findMany({
        where: and(eq(testCases.agentId, agent.id), eq(testCases.locationId, request.session.locationId)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      })
      if (rows.length === 0) return reply.code(409).send({ error: 'no test cases' })

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
      if (failures.length === 0) {
        return reply.code(409).send({ error: 'no failed criteria to improve' })
      }

      try {
        const result = await completeStructured({
          system: SUGGEST_TEST_PROMPT_SYSTEM,
          user: buildSuggestTestPromptUser({
            agentName: agent.name,
            currentPrompt: agent.prompt,
            failures: failures.slice(0, 40),
          }),
          schema: suggestedTestPromptSchema,
          maxOutputTokens: 12_000,
        })
        return {
          currentPrompt: agent.prompt,
          revisedPrompt: result.data.revisedPrompt,
          summary: result.data.summary,
        }
      } catch (error) {
        if ((error as { code?: string }).code === 'LLM_DISABLED') {
          return reply.code(503).send({ error: 'llm_disabled' })
        }
        throw error
      }
    },
  )

  app.patch(
    '/api/agents/:id/prompt',
    { schema: { params: idParam, body: agentPromptSchema } },
    async (request, reply) => {
      const [updated] = await db
        .update(agents)
        .set({ prompt: request.body.prompt })
        .where(and(eq(agents.id, request.params.id), eq(agents.locationId, request.session.locationId)))
        .returning({ id: agents.id, prompt: agents.prompt })
      if (!updated) return reply.code(404).send({ error: 'agent not found' })
      return updated
    },
  )
}
