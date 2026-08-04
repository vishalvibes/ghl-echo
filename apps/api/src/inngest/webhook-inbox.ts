import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { webhookEvents } from '../db/schema.js'
import { EVENT_WEBHOOK_RECEIVED, inngest } from './client.js'

export const VOICE_CALL_EVENT_TYPE = 'voice_call.completed'

export async function sendWebhookEvents(webhookEventIds: string[]): Promise<void> {
  if (webhookEventIds.length === 0) return

  await inngest.send(
    webhookEventIds.map((webhookEventId) => ({
      name: EVENT_WEBHOOK_RECEIVED,
      data: { webhookEventId },
    })),
  )
}

/** Requeue signed deliveries that arrived before this location completed OAuth. */
export async function replayWaitingWebhookEvents(locationId: string): Promise<number> {
  const waiting = await db.query.webhookEvents.findMany({
    where: and(
      eq(webhookEvents.locationId, locationId),
      eq(webhookEvents.status, 'waiting_authorization'),
    ),
    columns: { id: true },
    limit: 100,
  })
  const ids = waiting.map((row) => row.id)
  if (ids.length === 0) return 0

  await db
    .update(webhookEvents)
    .set({ status: 'pending', error: null, updatedAt: new Date() })
    .where(inArray(webhookEvents.id, ids))

  await sendWebhookEvents(ids)
  return ids.length
}
