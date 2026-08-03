import { turnSchema, type Turn, type TurnRole } from '@copilot/shared'

/**
 * HighLevel returns call transcripts in more than one shape depending on which
 * Voice AI provider produced them. Normalizing here means the judge, the
 * dashboard, and every stored turn id see exactly one format.
 */

/** Loosely-typed transcript entry as it arrives from the GHL API. */
export interface RawTranscriptEntry {
  role?: string
  speaker?: string
  participant?: string
  text?: string
  message?: string
  transcript?: string
  content?: string
  startTime?: number
  start?: number
  timestamp?: number
  offsetMs?: number
}

const AGENT_ALIASES = new Set(['agent', 'assistant', 'ai', 'bot', 'system_agent', 'outbound'])
const CALLER_ALIASES = new Set(['user', 'caller', 'customer', 'human', 'contact', 'inbound'])

function toRole(raw: string | undefined): TurnRole {
  const value = (raw ?? '').trim().toLowerCase()
  if (AGENT_ALIASES.has(value)) return 'agent'
  if (CALLER_ALIASES.has(value)) return 'caller'
  return 'system'
}

function toText(entry: RawTranscriptEntry): string {
  return (entry.text ?? entry.message ?? entry.transcript ?? entry.content ?? '').trim()
}

function toStartMs(entry: RawTranscriptEntry): number | null {
  const candidates = [entry.offsetMs, entry.startTime, entry.start, entry.timestamp]
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      // Providers disagree on units; sub-1000 values are seconds in practice.
      return Math.round(value < 1000 ? value * 1000 : value)
    }
  }
  return null
}

/**
 * Convert a raw provider transcript into ordered, id-stamped turns.
 *
 * Empty entries are dropped *before* ids are assigned, so ids are always a
 * dense 0..n-1 range over the turns the user actually sees. Sparse ids would
 * make "highlight turns 4-6" ambiguous in the UI.
 */
export function normalizeTranscript(raw: RawTranscriptEntry[]): Turn[] {
  return raw
    .map((entry) => ({
      role: toRole(entry.role ?? entry.speaker ?? entry.participant),
      text: toText(entry),
      startMs: toStartMs(entry),
    }))
    .filter((entry) => entry.text.length > 0)
    .map((entry, index) => turnSchema.parse({ ...entry, id: index }))
}

/** Split a plain-text "Agent: ... / Caller: ..." transcript into turns. */
export function normalizePlainText(text: string): Turn[] {
  const entries: RawTranscriptEntry[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z ]{2,20}?)\s*:\s*(.+)$/.exec(line)
    if (match) {
      entries.push({ role: match[1], text: match[2] })
    } else if (line.trim() && entries.length > 0) {
      // Continuation of the previous speaker's line.
      const last = entries[entries.length - 1]!
      last.text = `${last.text} ${line.trim()}`
    }
  }
  return normalizeTranscript(entries)
}

/** Total spoken characters — a cheap proxy for whether a call is judgeable. */
export function transcriptLength(turns: Turn[]): number {
  return turns.reduce((sum, turn) => sum + turn.text.length, 0)
}

/** Calls too short to say anything meaningful about. Skipped, not failed. */
export const MIN_JUDGEABLE_TURNS = 3
export const MIN_JUDGEABLE_CHARS = 80

export function isJudgeable(turns: Turn[]): boolean {
  return turns.length >= MIN_JUDGEABLE_TURNS && transcriptLength(turns) >= MIN_JUDGEABLE_CHARS
}
