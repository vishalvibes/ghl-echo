import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { webhookEvents } from '../db/schema.js'
import { EVENT_WEBHOOK_RECEIVED, inngestClient } from '../clients/inngest.js'

export const VOICE_CALL_EVENT_TYPE = 'voice_call.completed'

export async function storeWebhookEvent(args: {
  locationId: string
  providerEventId: string
  payload: Record<string, unknown>
  authorized: boolean
}): Promise<{ id: string } | null> {
  const [stored] = await db
    .insert(webhookEvents)
    .values({
      locationId: args.locationId,
      providerEventId: args.providerEventId,
      eventType: VOICE_CALL_EVENT_TYPE,
      payload: args.payload,
      status: args.authorized ? 'pending' : 'waiting_authorization',
    })
    .onConflictDoNothing({
      target: [
        webhookEvents.locationId,
        webhookEvents.eventType,
        webhookEvents.providerEventId,
      ],
    })
    .returning({ id: webhookEvents.id })

  return stored ?? null
}

export async function sendWebhookEvents(webhookEventIds: string[]): Promise<void> {
  if (webhookEventIds.length === 0) return

  await inngestClient.send(
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
