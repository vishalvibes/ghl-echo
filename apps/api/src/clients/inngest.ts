import { Inngest } from 'inngest'
import { env } from '../config/env.js'

/**
 * Event names are the public contract between the webhook receiver (fast,
 * dumb) and the workers (slow, LLM-bound). Inngest v4 has no client-level
 * event typing, so the payload shapes are documented here and cast at the
 * function boundary.
 *
 *   call/webhook.received           { webhookEventId: string }
 *   call/transcript.received        { callId: string; processingKey: string }
 *   agent/backfill.requested        { locationId: string; agentId?: string }
 *   agent/test-cases.confirm        { agentId, locationId, jobId, edgeCases }
 *   agent/test-cases.run            { agentId, locationId, jobId }
 *   agent/test-cases.suggest        { agentId, locationId, jobId }
 */
export const EVENT_WEBHOOK_RECEIVED = 'call/webhook.received'
export const EVENT_TRANSCRIPT_RECEIVED = 'call/transcript.received'
export const EVENT_BACKFILL_REQUESTED = 'agent/backfill.requested'
export const EVENT_TEST_CASES_CONFIRM = 'agent/test-cases.confirm'
export const EVENT_TEST_CASES_RUN = 'agent/test-cases.run'
export const EVENT_TEST_CASES_SUGGEST = 'agent/test-cases.suggest'

export const inngestClient = new Inngest({
  id: 'voice-ai-copilot',
  isDev: env.INNGEST_DEV === '1',
  ...(env.INNGEST_EVENT_KEY ? { eventKey: env.INNGEST_EVENT_KEY } : {}),
  ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}),
})
