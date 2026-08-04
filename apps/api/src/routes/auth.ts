import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { env } from '../config/env.js'
import { inngestClient } from '../clients/inngest.js'
import { db } from '../db/client.js'
import { locations } from '../db/schema.js'
import { exchangeAuthCode, resolveLocationToken, storeTokens } from '../clients/highlevel.js'
import { decryptSsoPayload } from '../lib/highlevel-sso.js'
import { issueSession, readSession, SESSION_COOKIE } from '../lib/session.js'
import { replayWaitingWebhookEvents } from '../services/webhook-inbox.js'

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}
import { syncAgentsForLocation } from './agent-sync.js'
import { DEMO_LOCATION_GHL_ID } from '../db/seed.js'

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * OAuth redirect target for the marketplace install flow. GHL sends a code;
   * we exchange it, store tokens, sync agents, and kick off a backfill so the
   * dashboard is populated by the time the user first opens it.
   */
  app.get(
    '/auth/oauth/callback',
    { schema: { querystring: z.object({ code: z.string() }) } },
    async (request, reply) => {
      const companyOrLocationTokens = await exchangeAuthCode(request.query.code)
      const tokens = await resolveLocationToken(companyOrLocationTokens)
      if (!tokens.locationId) {
        return reply.code(400).send({ error: 'token response carried no locationId' })
      }
      const location = await storeTokens(tokens.locationId, tokens)

      try {
        await replayWaitingWebhookEvents(location.id)
      } catch (error) {
        // Rows are already pending in Postgres and the sweep will resend them.
        request.log.error({ err: error }, 'post-install webhook replay failed')
      }

      try {
        await syncAgentsForLocation(location)
      } catch (error) {
        request.log.error({ err: error }, 'post-install agent sync failed')
      }

      try {
        await inngestClient.send({ name: 'agent/backfill.requested', data: { locationId: location.id } })
      } catch (error) {
        // Install must not fail because reconciliation could not be queued.
        // Live webhooks remain durable; the failure is visible in logs.
        request.log.error({ err: error }, 'post-install backfill dispatch failed')
      }

      await issueSession(
        reply,
        {
          locationId: location.id,
          ghlLocationId: location.ghlLocationId,
          userName: null,
        },
        request,
      )
      return reply.redirect('/installed')
    },
  )

  /**
   * SSO exchange for the iframe. The Vue app forwards the encrypted payload
   * it received from the GHL parent window's REQUEST_USER_DATA_RESPONSE
   * postMessage; we decrypt it with the app's Shared Secret (GHL_SSO_KEY),
   * confirm the location is actually installed, then issue our own cookie.
   * GHL's decrypted shape isn't documented, so we accept whichever location
   * field it actually sends.
   */
  app.post(
    '/auth/sso',
    { schema: { body: z.object({ key: z.string().min(1) }) } },
    async (request, reply) => {
      let payload: unknown
      try {
        payload = decryptSsoPayload(request.body.key)
      } catch (error) {
        request.log.error({ err: error }, 'SSO payload decryption failed')
        return reply.code(400).send({ error: 'invalid SSO payload' })
      }
      const data = payload as Record<string, unknown>
      const ghlLocationId = [data.activeLocation, data.locationId, data.location_id].find(
        (v): v is string => typeof v === 'string' && v.length > 0,
      )
      if (!ghlLocationId) {
        return reply.code(400).send({ error: 'SSO payload carried no location id' })
      }
      const location = await db.query.locations.findFirst({
        where: eq(locations.ghlLocationId, ghlLocationId),
      })
      if (!location || location.uninstalledAt) {
        return reply.code(403).send({ error: 'app not installed for this location' })
      }
      const userName = [data.userName, data.email].find((v): v is string => typeof v === 'string') ?? null
      await issueSession(
        reply,
        {
          locationId: location.id,
          ghlLocationId: location.ghlLocationId,
          userName,
        },
        request,
      )
      return { ok: true }
    },
  )

  /**
   * Legacy session exchange, kept for the dev/standalone fallback: the Vue
   * app posts a plain ghlLocationId directly (no GHL involved). `/auth/sso`
   * above is the real iframe path now that GHL_SSO_KEY is configured.
   */
  app.post(
    '/auth/session',
    {
      schema: {
        body: z.object({
          ghlLocationId: z.string().min(1),
          userName: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const location = await db.query.locations.findFirst({
        where: eq(locations.ghlLocationId, request.body.ghlLocationId),
      })
      if (!location || location.uninstalledAt) {
        return reply.code(403).send({ error: 'app not installed for this location' })
      }
      await issueSession(
        reply,
        {
          locationId: location.id,
          ghlLocationId: location.ghlLocationId,
          userName: request.body.userName ?? null,
        },
        request,
      )
      return { ok: true }
    },
  )

  /**
   * Standalone email+password login (used when the dashboard is opened
   * outside the HighLevel iframe). Credentials come from env
   * (DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD) and map to the demo location —
   * deliberately not a user system; GHL owns real identity.
   */
  app.post(
    '/auth/login',
    {
      schema: {
        body: z.object({ email: z.string().min(1), password: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const emailOk = safeEqual(request.body.email.trim().toLowerCase(), env.DEMO_LOGIN_EMAIL.toLowerCase())
      const passwordOk = safeEqual(request.body.password, env.DEMO_LOGIN_PASSWORD)
      if (!emailOk || !passwordOk) {
        return reply.code(401).send({ error: 'Invalid email or password' })
      }
      const location = await db.query.locations.findFirst({
        where: eq(locations.ghlLocationId, DEMO_LOCATION_GHL_ID),
      })
      if (!location) {
        return reply.code(409).send({ error: 'demo location missing — run `make seed`' })
      }
      await issueSession(
        reply,
        {
          locationId: location.id,
          ghlLocationId: location.ghlLocationId,
          userName: request.body.email.trim(),
        },
        request,
      )
      return { ok: true }
    },
  )

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  /** Dev-only: session for the seeded demo location. Disabled in production. */
  app.post('/auth/dev-session', async (request, reply) => {
    if (env.NODE_ENV === 'production') {
      return reply.code(404).send({ error: 'not found' })
    }
    const location = await db.query.locations.findFirst({
      where: eq(locations.ghlLocationId, DEMO_LOCATION_GHL_ID),
    })
    if (!location) {
      return reply.code(409).send({ error: 'demo location missing — run `pnpm --filter @copilot/api seed`' })
    }
    await issueSession(
      reply,
      {
        locationId: location.id,
        ghlLocationId: location.ghlLocationId,
        userName: 'Demo user',
      },
      request,
    )
    return { ok: true }
  })

  app.get('/auth/me', async (request, reply) => {
    const session = await readSession(request)
    if (!session) return reply.code(401).send({ error: 'unauthenticated' })
    return session
  })
}
