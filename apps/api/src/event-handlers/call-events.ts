import { eq } from 'drizzle-orm'
import { NonRetriableError } from 'inngest'
import { db } from '../db/client.js'
import { calls, locations } from '../db/schema.js'
import { evaluateCall } from '../calls/evaluate.js'
import { ingestCallFromGhl, listBackfillCandidates } from '../calls/import-from-highlevel.js'
import { assessQualityCall } from '../calls/quality.js'
import { LlmDisabledError } from '../lib/llm.js'
import {
  EVENT_BACKFILL_REQUESTED,
  EVENT_TRANSCRIPT_RECEIVED,
  inngestClient,
} from '../clients/inngest.js'

/** Process one call through durable, independently retryable stages. */
export const handleCallEvent = inngestClient.createFunction(
  {
    id: 'process-call',
    retries: 3,
    concurrency: { limit: 4 },
    idempotency: 'event.data.processingKey',
    triggers: [{ event: EVENT_TRANSCRIPT_RECEIVED }],
  },
  async ({ event, step }) => {
    const callId = (event.data as { callId: string; processingKey: string }).callId

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
export const handleAgentBackfill = inngestClient.createFunction(
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
        newCallIds.map((callId) => ({
          name: EVENT_TRANSCRIPT_RECEIVED,
          data: { callId, processingKey: `call:${callId}` },
        })),
      )
    }

    return { discovered: candidates.length, ingested: newCallIds.length }
  },
)
