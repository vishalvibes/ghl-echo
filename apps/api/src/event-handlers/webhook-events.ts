import { and, eq, inArray, sql } from 'drizzle-orm'
import { NonRetriableError } from 'inngest'
import { db } from '../db/client.js'
import { calls, locations, webhookEvents } from '../db/schema.js'
import { ingestCallFromGhl, toCandidate } from '../calls/import-from-highlevel.js'
import {
  EVENT_TRANSCRIPT_RECEIVED,
  EVENT_WEBHOOK_RECEIVED,
  inngestClient,
} from '../clients/inngest.js'

/** Turn one durable webhook inbox row into a normalized call. */
export const handleWebhookEvent = inngestClient.createFunction(
  {
    id: 'process-call-webhook',
    retries: 5,
    concurrency: { limit: 10 },
    triggers: [{ event: EVENT_WEBHOOK_RECEIVED }],
  },
  async ({ event, step }) => {
    const webhookEventId = (event.data as { webhookEventId: string }).webhookEventId

    const inbox = await step.run('claim-webhook', async () => {
      const [row] = await db
        .update(webhookEvents)
        .set({
          status: 'processing',
          attempts: sql`${webhookEvents.attempts} + 1`,
          error: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(webhookEvents.id, webhookEventId),
            inArray(webhookEvents.status, ['pending', 'failed']),
          ),
        )
        .returning({
          id: webhookEvents.id,
          locationId: webhookEvents.locationId,
          payload: webhookEvents.payload,
        })
      return row ?? null
    })

    if (!inbox) return { webhookEventId, skipped: true }

    const authorization = await step.run('check-authorization', async () => {
      const location = await db.query.locations.findFirst({
        where: eq(locations.id, inbox.locationId),
        columns: { id: true, accessToken: true, refreshToken: true },
      })
      return {
        exists: Boolean(location),
        authorized: Boolean(location?.accessToken && location.refreshToken),
      }
    })

    if (!authorization.exists) {
      await step.run('mark-missing-location', async () => {
        await db
          .update(webhookEvents)
          .set({ status: 'failed', error: 'Location no longer exists', updatedAt: new Date() })
          .where(eq(webhookEvents.id, inbox.id))
      })
      throw new NonRetriableError('Webhook location no longer exists')
    }

    if (!authorization.authorized) {
      await step.run('wait-for-authorization', async () => {
        await db
          .update(webhookEvents)
          .set({
            status: 'waiting_authorization',
            error: 'OAuth authorization required',
            updatedAt: new Date(),
          })
          .where(eq(webhookEvents.id, inbox.id))
      })
      return { webhookEventId, waitingAuthorization: true }
    }

    try {
      const result = await step.run('ingest-call', async () => {
        const candidate = toCandidate(inbox.payload)
        if (!candidate) throw new NonRetriableError('Stored webhook payload is not a call')

        const location = await db.query.locations.findFirst({
          where: eq(locations.id, inbox.locationId),
        })
        if (!location) throw new NonRetriableError('Webhook location no longer exists')

        const insertedCallId = await ingestCallFromGhl(location, candidate)
        if (insertedCallId) return { callId: insertedCallId, inserted: true }

        const existing = await db.query.calls.findFirst({
          where: and(
            eq(calls.locationId, inbox.locationId),
            eq(calls.ghlCallId, candidate.ghlCallId),
          ),
          columns: { id: true },
        })
        if (existing) return { callId: existing.id, inserted: false }

        throw new NonRetriableError(`Voice agent ${candidate.ghlAgentId} could not be resolved`)
      })

      await step.sendEvent('process-call', {
        name: EVENT_TRANSCRIPT_RECEIVED,
        data: { callId: result.callId, processingKey: `call:${result.callId}` },
      })

      await step.run('mark-webhook-processed', async () => {
        await db
          .update(webhookEvents)
          .set({
            status: 'processed',
            error: null,
            processedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(webhookEvents.id, inbox.id))
      })

      return { webhookEventId, ...result }
    } catch (error) {
      await step.run('mark-webhook-failed', async () => {
        const message = error instanceof Error ? error.message : 'Unknown webhook processing error'
        await db
          .update(webhookEvents)
          .set({ status: 'failed', error: message.slice(0, 500), updatedAt: new Date() })
          .where(eq(webhookEvents.id, inbox.id))
      })
      throw error
    }
  },
)
