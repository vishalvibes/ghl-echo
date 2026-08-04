import { eq } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { locations, type LocationRow } from '../db/schema.js'
import { decryptToken, encryptToken } from '../lib/token-encryption.js'

/**
 * Minimal HighLevel API client: OAuth token lifecycle plus the three reads
 * this product needs (agents, calls/conversations, transcripts). Everything
 * is per-location — GHL issues tokens per installed sub-account.
 */

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
  locationId?: string
  companyId?: string
  userType?: 'Company' | 'Location'
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${env.GHL_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GHL_CLIENT_ID,
      client_secret: env.GHL_CLIENT_SECRET,
      ...body,
    }),
  })
  if (!response.ok) {
    throw new Error(`GHL token endpoint ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }
  return (await response.json()) as TokenResponse
}

export async function exchangeAuthCode(code: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.GHL_REDIRECT_URI,
    user_type: 'Location',
  })
}

interface InstalledLocationsResponse {
  locations: { _id: string }[]
}

/**
 * Agency-admin installs of a Sub-Account-targeted app always return a
 * Company-scoped token (isBulkInstallation is true even for a single
 * selected location) — GHL never hands us the locationId directly. We look
 * up which location(s) were granted via the company token, then mint a
 * real Location-scoped token for the first one.
 *
 * `appId` must be the bare 24-char Mongo id — client_id carries a
 * `-<clientKey>` suffix that GHL's installedLocations endpoint rejects.
 */
export async function resolveLocationToken(tokens: TokenResponse): Promise<TokenResponse> {
  if (tokens.locationId) return tokens
  if (tokens.userType !== 'Company' || !tokens.companyId) {
    throw new Error('token response carried no locationId and is not a Company token')
  }

  const appId = env.GHL_CLIENT_ID.split('-')[0]
  const listUrl = new URL('/oauth/installedLocations', env.GHL_API_BASE)
  listUrl.searchParams.set('companyId', tokens.companyId)
  listUrl.searchParams.set('appId', appId!)
  const listResponse = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Version: env.GHL_API_VERSION,
      Accept: 'application/json',
    },
  })
  if (!listResponse.ok) {
    throw new Error(`GHL installedLocations ${listResponse.status}: ${(await listResponse.text()).slice(0, 300)}`)
  }
  const { locations: installed } = (await listResponse.json()) as InstalledLocationsResponse
  const locationId = installed[0]?._id
  if (!locationId) throw new Error('company token carried no installed locations')

  const tokenResponse = await fetch(`${env.GHL_API_BASE}/oauth/locationToken`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Version: env.GHL_API_VERSION,
    },
    body: new URLSearchParams({ companyId: tokens.companyId, locationId }),
  })
  if (!tokenResponse.ok) {
    throw new Error(`GHL locationToken ${tokenResponse.status}: ${(await tokenResponse.text()).slice(0, 300)}`)
  }
  return (await tokenResponse.json()) as TokenResponse
}

export async function storeTokens(ghlLocationId: string, tokens: TokenResponse, name?: string): Promise<LocationRow> {
  const values = {
    accessToken: encryptToken(tokens.access_token),
    refreshToken: encryptToken(tokens.refresh_token),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope ?? null,
    ghlCompanyId: tokens.companyId ?? null,
    uninstalledAt: null,
  }
  const existing = await db.query.locations.findFirst({
    where: eq(locations.ghlLocationId, ghlLocationId),
  })
  if (existing) {
    const [updated] = await db.update(locations).set(values).where(eq(locations.id, existing.id)).returning()
    return updated!
  }
  const [created] = await db
    .insert(locations)
    .values({ ghlLocationId, name: name ?? 'HighLevel location', ...values })
    .returning()
  return created!
}

/** Refresh 5 minutes early so an in-flight request never carries a dead token. */
const REFRESH_SKEW_MS = 5 * 60 * 1000

export async function getAccessToken(location: LocationRow): Promise<string> {
  if (!location.accessToken || !location.refreshToken) {
    throw new Error(`Location ${location.ghlLocationId} has no stored tokens — reinstall the app`)
  }
  const expiresAt = location.tokenExpiresAt?.getTime() ?? 0
  if (expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return decryptToken(location.accessToken)
  }
  const refreshed = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: decryptToken(location.refreshToken),
  })
  await storeTokens(location.ghlLocationId, refreshed)
  return refreshed.access_token
}

async function ghlGet<T>(location: LocationRow, path: string, params?: Record<string, string>): Promise<T> {
  const token = await getAccessToken(location)
  const url = new URL(path, env.GHL_API_BASE)
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v)

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: env.GHL_API_VERSION,
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new Error(`GHL GET ${path} ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }
  return (await response.json()) as T
}

// --- Reads this product depends on ------------------------------------------

/** Voice AI agents configured on the location. Real GHL fields are agentName/agentPrompt. */
export async function fetchVoiceAgents(location: LocationRow): Promise<
  Array<{ id: string; name: string; prompt?: string }>
> {
  const data = await ghlGet<{ agents?: Array<{ id: string; agentName: string; agentPrompt?: string }> }>(
    location,
    '/voice-ai/agents',
    { locationId: location.ghlLocationId },
  )
  return (data.agents ?? []).map((a) => ({ id: a.id, name: a.agentName, prompt: a.agentPrompt }))
}

/**
 * One Voice AI agent by id, for calls that arrive before the agent has been
 * synced. Falls back to scanning the list endpoint, because a call can name an
 * agent id the by-id route does not serve (deleted, or a shape we haven't seen
 * — GHL's Voice AI API is young).
 */
export async function fetchVoiceAgent(
  location: LocationRow,
  ghlAgentId: string,
): Promise<{ id: string; name: string; prompt?: string } | null> {
  try {
    const data = await ghlGet<{
      agent?: { id: string; agentName: string; agentPrompt?: string }
    }>(location, `/voice-ai/agents/${ghlAgentId}`, { locationId: location.ghlLocationId })
    if (data.agent) {
      return { id: data.agent.id, name: data.agent.agentName, prompt: data.agent.agentPrompt }
    }
  } catch {
    // Fall through to the list scan below.
  }
  const all = await fetchVoiceAgents(location)
  return all.find((a) => a.id === ghlAgentId) ?? null
}

/**
 * Recent Voice AI call logs for backfill. Response field is `callLogs`
 * (not `calls`); the endpoint 422s on an unrecognized `limit` param — it has
 * its own pagination scheme we haven't needed yet with zero real call volume
 * to test against. Revisit once a location has enough calls to paginate.
 */
export async function fetchCallLogs(
  location: LocationRow,
  opts: { agentId?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const data = await ghlGet<{ callLogs?: Array<Record<string, unknown>>; totalRecords?: number }>(
    location,
    '/voice-ai/dashboard/call-logs',
    {
      locationId: location.ghlLocationId,
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
    },
  )
  return data.callLogs ?? []
}

/** Transcript for one call. Raw shape varies by provider; normalized later. */
export async function fetchTranscript(location: LocationRow, callId: string): Promise<unknown> {
  return ghlGet(location, `/voice-ai/dashboard/call-logs/${callId}/transcript`, {
    locationId: location.ghlLocationId,
  })
}
