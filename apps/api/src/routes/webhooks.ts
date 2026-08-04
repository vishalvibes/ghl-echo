import { createPublicKey, verify as verifySignatureBytes } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { eq } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { locations } from '../db/schema.js'
import { ingestCallFromGhl, toCandidate } from '../ingest/ghl-ingest.js'
import { inngest } from '../inngest/client.js'

/**
 * Inbound webhook from HighLevel, fired when a Voice AI call completes.
 *
 * Contract with GHL: answer 200 fast or get retried. So the handler does the
 * minimum — verify, dedupe-insert the call as pending, emit one Inngest event
 * — and the LLM work happens in the worker. At-least-once delivery is handled
 * by the unique (location, ghl_call_id) index; a duplicate insert is a no-op
 * and no second event is sent.
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
const GHL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`

const GHL_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`

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
        createPublicKey(GHL_ED25519_PUBLIC_KEY),
        Buffer.from(headers.ed25519, 'base64'),
      )
    }
    if (headers.rsa) {
      return verifySignatureBytes(
        'sha256',
        body,
        createPublicKey(GHL_RSA_PUBLIC_KEY),
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

        if (!location.accessToken || !location.refreshToken) {
          // A signed webhook can arrive before OAuth finishes, or after a
          // local database reset. Keep the tenant so SSO/OAuth can enrich this
          // same row; the install backfill will recover this call afterward.
          request.log.warn(
            { ghlLocationId },
            'location discovered but awaiting OAuth authorization',
          )
          return { ok: true, accepted: true, pendingAuthorization: true }
        }

        const candidate = toCandidate(payload)
        if (!candidate) {
          request.log.warn({ keys: Object.keys(payload) }, 'webhook payload not mappable to a call')
          return { ok: true, ignored: 'payload not mappable' }
        }

        const callId = await ingestCallFromGhl(location, candidate)
        if (callId) {
          await inngest.send({ name: 'call/transcript.received', data: { callId } })
        } else {
          // Either a duplicate delivery or an agent id GHL cannot account for.
          // Both answer 200, so say which in the log — they are otherwise
          // indistinguishable from a successful ingest.
          request.log.info(
            { ghlCallId: candidate.ghlCallId, ghlAgentId: candidate.ghlAgentId },
            'webhook call not ingested (already stored, or unknown agent)',
          )
        }
        return { ok: true, ingested: callId !== null }
      },
    )
  }
}
