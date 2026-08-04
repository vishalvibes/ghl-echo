import { createPublicKey, verify as verifySignatureBytes } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { eq } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { locations, webhookEvents } from '../db/schema.js'
import { toCandidate } from '../ingest/ghl-ingest.js'
import { sendWebhookEvents, VOICE_CALL_EVENT_TYPE } from '../inngest/webhook-inbox.js'

/**
 * Inbound webhook from HighLevel, fired when a Voice AI call completes.
 *
 * Contract with GHL: answer 200 fast or get retried. So the handler does the
 * minimum — verify, persist the delivery in a durable inbox, and emit one
 * Inngest event. The inbox unique key handles retries; its status lets the
 * recovery sweep repair a failed event send or a pre-OAuth delivery.
 */

/**
 * HighLevel signs the raw request body with its own private key, so there is
 * no shared secret to HMAC against — verification uses HighLevel's published
 * public keys. Both signatures are base64 over the exact bytes received.
 *
 *   X-GHL-Signature  Ed25519      current
 *   X-WH-Signature   RSA-SHA256   legacy, deprecated 2026-09-01
 *
 * Docs: https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/
 */
const ghlEd25519PublicKey = env.GHL_VERIFY_WEBHOOKS
  ? createPublicKey(env.GHL_ED25519_PUBLIC_KEY)
  : null
const ghlRsaPublicKey = env.GHL_VERIFY_WEBHOOKS ? createPublicKey(env.GHL_RSA_PUBLIC_KEY) : null

function header(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * `rawBody` is the untouched request bytes. If it is missing the request never
 * went through the raw-body plugin, and re-serializing `request.body` would
 * produce different bytes than were signed — so verification fails closed
 * rather than silently comparing the wrong thing.
 */
function verifyWebhook(
  rawBody: string | undefined,
  headers: { ed25519?: string; rsa?: string },
): boolean {
  if (!env.GHL_VERIFY_WEBHOOKS) return true
  if (!rawBody) return false

  const body = Buffer.from(rawBody, 'utf8')
  try {
    if (headers.ed25519) {
      return verifySignatureBytes(
        null,
        body,
        ghlEd25519PublicKey!,
        Buffer.from(headers.ed25519, 'base64'),
      )
    }
    if (headers.rsa) {
      return verifySignatureBytes(
        'sha256',
        body,
        ghlRsaPublicKey!,
        Buffer.from(headers.rsa, 'base64'),
      )
    }
  } catch {
    // Malformed key/signature material is a failed verification, not a crash.
    return false
  }
  return false
}

/**
 * Both paths run the same handler. `/webhooks/ghl` is what the marketplace
 * app's default webhook URL points at; `/webhooks/ghl/voice-ai` exists so a
 * single event can be given its own URL in the app's webhook settings, which
 * makes it obvious in the logs which subscription delivered a payload.
 */
const WEBHOOK_PATHS = ['/webhooks/ghl', '/webhooks/ghl/voice-ai'] as const

export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  for (const path of WEBHOOK_PATHS) {
    app.post(
      path,
      {
        config: { rawBody: true },
      },
      async (request, reply) => {
        const verified = verifyWebhook(request.rawBody as string | undefined, {
          ed25519: header(request.headers['x-ghl-signature']),
          rsa: header(request.headers['x-wh-signature']),
        })
        if (!verified) {
          return reply.code(401).send({ error: 'bad signature' })
        }

        const payload = request.body as Record<string, unknown>
        const ghlLocationId =
          typeof payload.locationId === 'string' ? payload.locationId : undefined
        if (!ghlLocationId) {
          // 200, not 4xx: GHL retries any non-2xx up to 12 times, and a payload
          // we cannot route will never become routable on a retry.
          request.log.warn({ keys: Object.keys(payload) }, 'webhook payload carried no locationId')
          return { ok: true, ignored: 'no locationId in payload' }
        }

        let location = await db.query.locations.findFirst({
          where: eq(locations.ghlLocationId, ghlLocationId),
        })
        if (!location) {
          const [created] = await db
            .insert(locations)
            .values({ ghlLocationId, name: 'HighLevel location' })
            // Concurrent webhook deliveries can discover the same location.
            .onConflictDoNothing({ target: locations.ghlLocationId })
            .returning()

          location =
            created ??
            (await db.query.locations.findFirst({
              where: eq(locations.ghlLocationId, ghlLocationId),
            }))

          request.log.info({ ghlLocationId }, 'discovered location from signed webhook')
        }
        if (!location || location.uninstalledAt) {
          // Do not reactivate an explicitly uninstalled tenant from a delayed
          // webhook. A new OAuth install clears `uninstalledAt`.
          return { ok: true, ignored: 'location not installed' }
        }

        const candidate = toCandidate(payload)
        if (!candidate) {
          request.log.warn({ keys: Object.keys(payload) }, 'webhook payload not mappable to a call')
          return { ok: true, ignored: 'payload not mappable' }
        }

        const authorized = Boolean(location.accessToken && location.refreshToken)
        const [stored] = await db
          .insert(webhookEvents)
          .values({
            locationId: location.id,
            providerEventId: candidate.ghlCallId,
            eventType: VOICE_CALL_EVENT_TYPE,
            payload,
            status: authorized ? 'pending' : 'waiting_authorization',
          })
          .onConflictDoNothing({
            target: [
              webhookEvents.locationId,
              webhookEvents.eventType,
              webhookEvents.providerEventId,
            ],
          })
          .returning({ id: webhookEvents.id })

        if (!stored) {
          return { ok: true, duplicate: true }
        }

        if (!authorized) {
          request.log.warn(
            { ghlLocationId, webhookEventId: stored.id },
            'webhook persisted while location awaits OAuth authorization',
          )
          return { ok: true, accepted: true, pendingAuthorization: true }
        }

        try {
          await sendWebhookEvents([stored.id])
        } catch (error) {
          // The delivery is already durable. A 2xx prevents needless provider
          // retries, while the scheduled sweep will resend this pending row.
          request.log.error(
            { err: error, webhookEventId: stored.id },
            'webhook persisted but Inngest dispatch failed',
          )
        }
        return { ok: true, accepted: true }
      },
    )
  }
}
