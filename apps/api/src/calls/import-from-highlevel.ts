import { and, eq } from 'drizzle-orm'
import { computeTranscriptMetrics, type CallDirection, type CallOutcome } from '@copilot/shared'
import { db } from '../db/client.js'
import { agents, calls, type LocationRow } from '../db/schema.js'
import { fetchCallLogs, fetchTranscript, fetchVoiceAgent } from '../clients/highlevel.js'
import { defaultAgentPrompt } from '../lib/default-prompt.js'
import { normalizePlainText, normalizeTranscript, type RawTranscriptEntry } from './normalize.js'

/**
 * Adapter from HighLevel call-log payloads to our `calls` rows. This is the only
 * file that knows what GHL's Voice AI shapes look like; everything past it
 * sees normalized turns.
 *
 * The field mapping is defensive by design — GHL's Voice AI API is young and
 * payload shapes differ between webhook and REST reads. Anything we cannot
 * map becomes a skipped ingest with a reason, never a crash.
 */

export interface CallCandidate {
  ghlCallId: string
  ghlAgentId: string
  contactName?: string
  contactPhone?: string
  direction: CallDirection
  outcome: CallOutcome
  startedAt: string
  durationSec: number
  /** Present when the payload carried the transcript inline. */
  transcript?: unknown
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function toOutcome(value: unknown): CallOutcome {
  const v = String(value ?? '').toLowerCase()
  if (v.includes('voicemail')) return 'voicemail'
  if (v.includes('no_answer') || v.includes('no-answer') || v.includes('missed')) return 'no_answer'
  if (v.includes('busy')) return 'busy'
  if (v.includes('fail') || v.includes('error')) return 'failed'
  return 'completed'
}

/** Map one raw GHL call-log object into a candidate, or null if unusable. */
export function toCandidate(raw: Record<string, unknown>): CallCandidate | null {
  const ghlCallId = str(raw.id) ?? str(raw.callId) ?? str(raw.callSid)
  const ghlAgentId = str(raw.agentId) ?? str(raw.assistantId) ?? str(raw.voiceAgentId)
  if (!ghlCallId || !ghlAgentId) return null

  const startedAt = str(raw.startedAt) ?? str(raw.createdAt) ?? str(raw.dateAdded)
  if (!startedAt) return null

  const durationRaw = raw.duration ?? raw.durationSec ?? raw.callDuration
  const durationSec = typeof durationRaw === 'number' ? Math.round(durationRaw) : 0

  return {
    ghlCallId,
    ghlAgentId,
    contactName: str(raw.contactName) ?? str(raw.fullName),
    contactPhone:
      str(raw.phone) ??
      str(raw.contactPhone) ??
      str(raw.fromNumber) ??
      str(raw.toNumber) ??
      str(raw.from) ??
      str(raw.to),
    direction: String(raw.direction ?? '').toLowerCase() === 'outbound' ? 'outbound' : 'inbound',
    outcome: toOutcome(raw.status ?? raw.outcome ?? raw.callStatus),
    startedAt,
    durationSec,
    transcript: raw.transcript ?? raw.messages,
  }
}

function normalizeAnyTranscript(raw: unknown): ReturnType<typeof normalizeTranscript> {
  if (Array.isArray(raw)) return normalizeTranscript(raw as RawTranscriptEntry[])
  if (typeof raw === 'string') return normalizePlainText(raw)
  if (raw && typeof raw === 'object') {
    const nested = (raw as Record<string, unknown>).transcript ?? (raw as Record<string, unknown>).messages
    if (nested !== undefined && nested !== raw) return normalizeAnyTranscript(nested)
  }
  return []
}

/**
 * Ingest one candidate: fetch its transcript if not inline, and insert the
 * call as `pending`. Returns the new call id, or null when the call already
 * exists / cannot be mapped to a known agent.
 */
/**
 * Find the agent a call belongs to, pulling it from HighLevel if we have never
 * seen it. Agents are created in GHL and can start taking calls before any
 * sync runs, so a webhook naming an unknown agent is normal — dropping those
 * calls would silently lose exactly the calls a newly built agent produces.
 *
 * Returns null only when GHL itself cannot account for the id; the caller
 * treats that as an unusable payload rather than an error.
 */
async function resolveAgent(location: LocationRow, ghlAgentId: string) {
  const existing = await db.query.agents.findFirst({
    where: and(eq(agents.locationId, location.id), eq(agents.ghlAgentId, ghlAgentId)),
  })
  if (existing) return existing

  const remote = await fetchVoiceAgent(location, ghlAgentId)
  if (!remote) return null

  const [created] = await db
    .insert(agents)
    .values({
      locationId: location.id,
      ghlAgentId: remote.id,
      name: remote.name,
      prompt: defaultAgentPrompt(),
      promptSnapshot: remote.prompt ?? null,
      promptSyncedAt: remote.prompt ? new Date() : null,
    })
    // A concurrent webhook for the same new agent may have won the race.
    .onConflictDoNothing({ target: [agents.locationId, agents.ghlAgentId] })
    .returning()

  return (
    created ??
    (await db.query.agents.findFirst({
      where: and(eq(agents.locationId, location.id), eq(agents.ghlAgentId, ghlAgentId)),
    }))
  )
}

export async function ingestCallFromGhl(
  location: LocationRow,
  candidate: CallCandidate,
): Promise<string | null> {
  const agent = await resolveAgent(location, candidate.ghlAgentId)
  if (!agent) return null // GHL does not know this agent id either

  const existing = await db.query.calls.findFirst({
    where: and(eq(calls.locationId, location.id), eq(calls.ghlCallId, candidate.ghlCallId)),
    columns: { id: true },
  })
  if (existing) return null

  let transcriptRaw = candidate.transcript
  if (transcriptRaw === undefined) {
    transcriptRaw = await fetchTranscript(location, candidate.ghlCallId)
  }
  const transcript = normalizeAnyTranscript(transcriptRaw)
  const metrics = computeTranscriptMetrics(transcript)

  const [inserted] = await db
    .insert(calls)
    .values({
      locationId: location.id,
      agentId: agent.id,
      ghlCallId: candidate.ghlCallId,
      contactName: candidate.contactName ?? null,
      contactPhone: candidate.contactPhone ?? null,
      direction: candidate.direction,
      outcome: candidate.outcome,
      startedAt: new Date(candidate.startedAt),
      durationSec: candidate.durationSec,
      transcript,
      metrics,
      ingestStatus: 'pending',
      isMock: false,
    })
    .onConflictDoNothing({ target: [calls.locationId, calls.ghlCallId] })
    .returning({ id: calls.id })

  return inserted?.id ?? null
}

export async function listBackfillCandidates(
  location: LocationRow,
  agentId?: string,
): Promise<CallCandidate[]> {
  let ghlAgentId: string | undefined
  if (agentId) {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) })
    ghlAgentId = agent?.ghlAgentId
  }
  const logs = await fetchCallLogs(location, { agentId: ghlAgentId })
  return logs.map(toCandidate).filter((candidate): candidate is CallCandidate => candidate !== null)
}
