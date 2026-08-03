import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm'
import {
  scorecardDraftSchema,
  suggestedCriteriaSchema,
  windowSchema,
  type CallDetail,
  type CallListItem,
  type Overview,
} from '@copilot/shared'
import { db } from '../db/client.js'
import {
  agents,
  calls,
  evaluations,
  findings,
  locations,
  scorecards,
  segments,
} from '../db/schema.js'
import { EVENT_BACKFILL_REQUESTED, inngest } from '../inngest/client.js'
import { syncAgentsForLocation } from './agent-sync.js'
import { activeScorecardFor } from '../ingest/evaluate.js'
import { getRecommendations } from '../insights/recommend.js'
import { requireSession } from '../lib/session.js'
import { completeStructured } from '../lib/llm.js'
import { SUGGEST_CRITERIA_SYSTEM_PROMPT } from '../scoring/prompts.js'
import { judgeCall } from '../scoring/judge.js'
import {
  computeAgentSummaries,
  computeCriterionBreakdown,
  computeFailureModes,
  computeKpis,
  computeTrend,
  windowStart,
} from './analytics.js'

const windowQuery = z.object({ window: windowSchema.default('7d') })
const idParam = z.object({ id: z.uuid() })

export const apiRoutes: FastifyPluginAsyncZod = async (app) => {
  // Every /api route requires an iframe session; tenant comes from the cookie.
  app.addHook('preHandler', requireSession)

  // --- Overview -------------------------------------------------------------

  app.get('/api/overview', { schema: { querystring: windowQuery } }, async (request): Promise<Overview> => {
    const { window } = request.query
    const scope = { locationId: request.session.locationId }
    const [kpis, trend, failureModes, agentSummaries] = await Promise.all([
      computeKpis(scope, window),
      computeTrend(scope, window),
      computeFailureModes(scope, window),
      computeAgentSummaries(scope.locationId, window),
    ])
    return { window, kpis, trend, failureModes, agents: agentSummaries }
  })

  // --- Agents ---------------------------------------------------------------

  app.get('/api/agents', async (request) => {
    const rows = await db.query.agents.findMany({
      where: eq(agents.locationId, request.session.locationId),
      orderBy: (a, { asc }) => [asc(a.name)],
      columns: { id: true, name: true, ghlAgentId: true, promptSyncedAt: true },
    })
    return { agents: rows }
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
      const [kpis, trend, failureModes, breakdown, scorecard] = await Promise.all([
        computeKpis(scope, window),
        computeTrend(scope, window),
        computeFailureModes(scope, window),
        computeCriterionBreakdown(agent.id, window),
        activeScorecardFor(agent.id),
      ])

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
          sql`exists (select 1 from ${segments} s where s.call_id = ${calls.id} and s.status = 'open')`,
        )
      }

      const base = db
        .select({
          id: calls.id,
          agentId: calls.agentId,
          agentName: agents.name,
          contactName: calls.contactName,
          contactPhone: calls.contactPhone,
          direction: calls.direction,
          outcome: calls.outcome,
          startedAt: calls.startedAt,
          durationSec: calls.durationSec,
          verdict: evaluations.verdict,
          overallScore: evaluations.overallScore,
          findingCount: sql<number>`(select count(*) from ${findings} f where f.call_id = ${calls.id})`,
          actionCount: sql<number>`(select count(*) from ${segments} s where s.call_id = ${calls.id} and s.status = 'open')`,
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
      direction: call.direction,
      outcome: call.outcome,
      startedAt: call.startedAt.toISOString(),
      durationSec: call.durationSec,
      verdict: evaluation?.verdict ?? null,
      overallScore: evaluation?.overallScore ?? null,
      findingCount: evaluation?.findings.length ?? 0,
      actionCount: evaluation?.segments.filter((s) => s.status === 'open').length ?? 0,
      transcript: call.transcript,
      recordingUrl: call.recordingUrl,
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
        eq(segments.locationId, request.session.locationId),
        eq(segments.status, request.query.status),
      ]
      if (request.query.actionType) conditions.push(eq(segments.actionType, request.query.actionType))

      const rows = await db
        .select({
          id: segments.id,
          callId: segments.callId,
          turnStart: segments.turnStart,
          turnEnd: segments.turnEnd,
          actionType: segments.actionType,
          reason: segments.reason,
          severity: segments.severity,
          status: segments.status,
          agentName: agents.name,
          contactPhone: calls.contactPhone,
          startedAt: calls.startedAt,
        })
        .from(segments)
        .innerJoin(calls, eq(segments.callId, calls.id))
        .innerJoin(agents, eq(segments.agentId, agents.id))
        .where(and(...conditions))
        .orderBy(
          sql`case ${segments.severity} when 'high' then 0 when 'medium' then 1 else 2 end`,
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
        .update(segments)
        .set({
          status: request.body.status,
          resolvedAt: request.body.status === 'open' ? null : new Date(),
        })
        .where(and(eq(segments.id, request.params.id), eq(segments.locationId, request.session.locationId)))
        .returning({ id: segments.id, status: segments.status })
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

    await inngest.send({
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
    const scorecard = await activeScorecardFor(agent.id)
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

      const current = await activeScorecardFor(agent.id)
      const nextVersion = (current?.version ?? 0) + 1

      const [created] = await db.transaction(async (tx) => {
        if (current) {
          await tx.update(scorecards).set({ isActive: false }).where(eq(scorecards.id, current.id))
        }
        return tx
          .insert(scorecards)
          .values({
            locationId: request.session.locationId,
            agentId: agent.id,
            version: nextVersion,
            passThreshold: request.body.passThreshold,
            partialThreshold: request.body.partialThreshold,
            criteria: request.body.criteria,
          })
          .returning()
      })
      return reply.code(201).send(created)
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
        temperature: 0.2,
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
}
