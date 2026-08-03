import { SignJWT, jwtVerify } from 'jose'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../config/env.js'

/**
 * Session for the iframe'd dashboard.
 *
 * The Vue app runs inside a HighLevel Custom Page. GHL hands the page an
 * encrypted user context; the frontend exchanges it at /auth/session for a
 * short-lived HttpOnly cookie scoped to one locationId. Every /api read then
 * derives its tenant from the cookie — never from a query parameter, which
 * anyone could edit.
 *
 * In development (no GHL app yet) /auth/dev-session issues a session for the
 * seeded demo location so the dashboard works standalone.
 */

export const SESSION_COOKIE = 'copilot_session'
const SESSION_TTL_SECONDS = 60 * 60 * 8

const secret = new TextEncoder().encode(env.SESSION_SECRET)

export interface SessionClaims {
  /** Internal locations.id (uuid), not the GHL location id. */
  locationId: string
  ghlLocationId: string
  userName: string | null
}

export async function issueSession(reply: FastifyReply, claims: SessionClaims, request: FastifyRequest): Promise<void> {
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret)

  // The dashboard is iframed from a GHL origin, so the cookie must ride
  // cross-site requests: SameSite=None + Secure whenever the browser is
  // actually talking to us over HTTPS (production, or a dev tunnel like
  // ngrok). Plain `http://localhost` dev — no tunnel — gets Lax, since
  // Secure cookies are silently dropped over HTTP and everything there is
  // same-site anyway.
  const isSecureRequest = request.protocol === 'https'
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    sameSite: isSecureRequest ? 'none' : 'lax',
    secure: isSecureRequest,
  })
}

export async function readSession(request: FastifyRequest): Promise<SessionClaims | null> {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    if (typeof payload.locationId !== 'string' || typeof payload.ghlLocationId !== 'string') {
      return null
    }
    return {
      locationId: payload.locationId,
      ghlLocationId: payload.ghlLocationId,
      userName: typeof payload.userName === 'string' ? payload.userName : null,
    }
  } catch {
    return null
  }
}

/** Route guard: 401 when there is no valid session. */
export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = await readSession(request)
  if (!session) {
    await reply.code(401).send({ error: 'unauthenticated' })
    return
  }
  request.session = session
}

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionClaims
  }
}
