import { and, eq, inArray, isNotNull, lt, or } from 'drizzle-orm'
import { NonRetriableError } from 'inngest'
import { db } from '../db/client.js'
import { calls, locations, webhookEvents } from '../db/schema.js'
import { evaluateCall } from '../ingest/evaluate.js'
import { ingestCallFromGhl, listBackfillCandidates } from '../ingest/ghl-ingest.js'
import { assessQualityCall } from '../ingest/quality.js'
import { LlmDisabledError } from '../lib/llm.js'
import {
  EVENT_BACKFILL_REQUESTED,
  EVENT_TRANSCRIPT_RECEIVED,
  EVENT_WEBHOOK_RECEIVED,
  inngest,
} from './client.js'
import { processWebhookFn } from './process-webhook.js'

/** Process one call through durable, independently retryable stages. */
export const processCallFn = inngest.createFunction(
  {
    id: 'process-call',
    retries: 3,
    concurrency: { limit: 4 },
    idempotency: 'event.data.callId',
    triggers: [{ event: EVENT_TRANSCRIPT_RECEIVED }],
  },
  async ({ event, step }) => {
    const callId = (event.data as { callId: string }).callId

    await step.run('mark-processing', async () => {
      await db
        .update(calls)
        .set({ ingestStatus: 'pending', ingestError: null })
        .where(eq(calls.id, callId))
    })

    const quality = await step.run('assess-quality', async () => {
      try {
        return await assessQualityCall(callId)
      } catch (error) {
        if (error instanceof LlmDisabledError) {
          await db
            .update(calls)
            .set({ ingestStatus: 'skipped', ingestError: 'LLM disabled' })
            .where(eq(calls.id, callId))
          throw new NonRetriableError('LLM disabled - enable OPENAI_ENABLED to process calls')
        }
        await db
          .update(calls)
          .set({ ingestStatus: 'failed', ingestError: (error as Error).message.slice(0, 500) })
          .where(eq(calls.id, callId))
        throw error
      }
    })

    const evaluation = await step.run('evaluate-scorecard', async () => {
      try {
        return await evaluateCall(callId)
      } catch (error) {
        if (error instanceof LlmDisabledError) {
          await db
            .update(calls)
            .set({ ingestStatus: 'skipped', ingestError: 'LLM disabled' })
            .where(eq(calls.id, callId))
          throw new NonRetriableError('LLM disabled - enable OPENAI_ENABLED to process calls')
        }
        throw error
      }
    })

    return { callId, quality, evaluation }
  },
)

/**
 * backfill-agent: pull historical call logs from GHL, ingest each, and fan
 * out one evaluate event per new call. Used right after install so the
 * dashboard has history on day one.
 */
export const backfillFn = inngest.createFunction(
  { id: 'backfill-agent', retries: 2, triggers: [{ event: EVENT_BACKFILL_REQUESTED }] },
  async ({ event, step }) => {
    const data = event.data as { locationId: string; agentId?: string }

    // step.run serializes return values to JSON, which mangles Date columns —
    // so steps pass ids across the boundary and re-load the row inside.
    const loadLocation = async () => {
      const row = await db.query.locations.findFirst({ where: eq(locations.id, data.locationId) })
      if (!row) throw new NonRetriableError(`Unknown location ${data.locationId}`)
      return row
    }

    const candidates = await step.run('list-call-logs', async () =>
      listBackfillCandidates(await loadLocation(), data.agentId),
    )

    const newCallIds: string[] = []
    for (const candidate of candidates) {
      const callId = await step.run(`ingest-${candidate.ghlCallId}`, async () =>
        ingestCallFromGhl(await loadLocation(), candidate),
      )
      if (callId) newCallIds.push(callId)
    }

    if (newCallIds.length > 0) {
      await step.sendEvent(
        'fan-out-evaluations',
        newCallIds.map((callId) => ({ name: EVENT_TRANSCRIPT_RECEIVED, data: { callId } })),
      )
    }

    return { discovered: candidates.length, ingested: newCallIds.length }
  },
)

/** Safety net for missed event sends and work interrupted mid-processing. */
export const sweepPendingFn = inngest.createFunction(
  { id: 'sweep-pending-calls', retries: 1, triggers: [{ cron: '*/15 * * * *' }] },
  async ({ step }) => {
    const pending = await step.run('find-pending', async () => {
      const rows = await db.query.calls.findMany({
        where: eq(calls.ingestStatus, 'pending'),
        limit: 20,
        columns: { id: true },
      })
      return rows.map((r) => r.id)
    })
    if (pending.length > 0) {
      await step.sendEvent(
        'requeue',
        pending.map((callId) => ({ name: EVENT_TRANSCRIPT_RECEIVED, data: { callId } })),
      )
    }

    const webhookEventIds = await step.run('find-recoverable-webhooks', async () => {
      const staleBefore = new Date(Date.now() - 30 * 60 * 1000)
      const rows = await db
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .innerJoin(locations, eq(locations.id, webhookEvents.locationId))
        .where(
          or(
            eq(webhookEvents.status, 'pending'),
            and(
              eq(webhookEvents.status, 'waiting_authorization'),
              isNotNull(locations.accessToken),
              isNotNull(locations.refreshToken),
            ),
            and(
              eq(webhookEvents.status, 'processing'),
              lt(webhookEvents.updatedAt, staleBefore),
            ),
          ),
        )
        .limit(100)

      const ids = rows.map((row) => row.id)
      if (ids.length > 0) {
        await db
          .update(webhookEvents)
          .set({ status: 'pending', error: null, updatedAt: new Date() })
          .where(inArray(webhookEvents.id, ids))
      }
      return ids
    })

    if (webhookEventIds.length > 0) {
      await step.sendEvent(
        'requeue-webhooks',
        webhookEventIds.map((webhookEventId) => ({
          name: EVENT_WEBHOOK_RECEIVED,
          data: { webhookEventId },
        })),
      )
    }

    return { callsRequeued: pending.length, webhooksRequeued: webhookEventIds.length }
  },
)

export const functions = [processWebhookFn, processCallFn, backfillFn, sweepPendingFn]
