import { and, eq, inArray, isNotNull, lt, or } from 'drizzle-orm'
import {
  EVENT_TRANSCRIPT_RECEIVED,
  EVENT_WEBHOOK_RECEIVED,
  inngestClient,
} from '../clients/inngest.js'
import { db } from '../db/client.js'
import { calls, locations, webhookEvents } from '../db/schema.js'

/** Safety net for missed event sends and work interrupted mid-processing. */
export const reconcilePendingWork = inngestClient.createFunction(
  { id: 'sweep-pending-calls', retries: 1, triggers: [{ cron: '*/15 * * * *' }] },
  async ({ step }) => {
    const pending = await step.run('find-pending', async () => {
      const rows = await db.query.calls.findMany({
        where: or(
          eq(calls.ingestStatus, 'pending'),
          and(
            eq(calls.ingestStatus, 'skipped'),
            eq(calls.ingestError, 'no active scorecard'),
          ),
        ),
        limit: 20,
        columns: { id: true },
      })
      return rows.map((row) => row.id)
    })
    if (pending.length > 0) {
      await step.sendEvent(
        'requeue',
        pending.map((callId) => ({
          name: EVENT_TRANSCRIPT_RECEIVED,
          data: { callId, processingKey: `recovery:${callId}` },
        })),
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
