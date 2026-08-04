import { Inngest } from 'inngest'
import { env } from '../config/env.js'

/**
 * Event names are the public contract between the webhook receiver (fast,
 * dumb) and the workers (slow, LLM-bound). Inngest v4 has no client-level
 * event typing, so the payload shapes are documented here and cast at the
 * function boundary.
 *
 *   call/webhook.received      { webhookEventId: string }
 *   call/transcript.received   { callId: string }
 *   agent/backfill.requested   { locationId: string; agentId?: string }
 */
export const EVENT_WEBHOOK_RECEIVED = 'call/webhook.received'
export const EVENT_TRANSCRIPT_RECEIVED = 'call/transcript.received'
export const EVENT_BACKFILL_REQUESTED = 'agent/backfill.requested'

export const inngest = new Inngest({
  id: 'voice-ai-copilot',
  isDev: env.INNGEST_DEV === '1',
  ...(env.INNGEST_EVENT_KEY ? { eventKey: env.INNGEST_EVENT_KEY } : {}),
  ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}),
})
