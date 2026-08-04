import { z } from 'zod'
import type { Turn } from './transcript.js'

/**
 * Deterministic conversation metrics derived from the transcript alone.
 *
 * Kept out of the judge on purpose, for the same reason `scoreCall` is: the
 * same transcript must always produce the same numbers, they cost nothing to
 * compute, and they still work when the LLM is disabled. They also give the
 * judge's opinion something independent to be checked against — a transcript
 * can read well while the mechanics of the conversation were bad.
 *
 * Everything here is a *proxy*. We have speaker-labelled text and, sometimes,
 * a turn start offset — no per-turn end time and no audio. Metrics that would
 * need those (true barge-in overlap, response latency, dead air) are absent
 * rather than approximated, because a confidently wrong number is worse than
 * a missing one.
 */

export const endpointingMetricsSchema = z.object({
  /** Caller turns that look cut off mid-sentence. */
  truncatedTurnIds: z.array(z.number().int().nonnegative()),
  /** Truncated caller turns the agent then spoke over — suspected barge-in. */
  interruptedTurnIds: z.array(z.number().int().nonnegative()),
  /** interruptedTurnIds ÷ caller turns, 0..1. */
  interruptionRate: z.number().min(0).max(1),
})
export type EndpointingMetrics = z.infer<typeof endpointingMetricsSchema>

export const repetitionPairSchema = z.object({
  /** The turn the caller had to repeat. */
  firstTurnId: z.number().int().nonnegative(),
  /** The turn where they said it again. */
  repeatedTurnId: z.number().int().nonnegative(),
})

export const transcriptMetricsSchema = z.object({
  turns: z.object({
    total: z.number().int().nonnegative(),
    agent: z.number().int().nonnegative(),
    caller: z.number().int().nonnegative(),
  }),
  words: z.object({
    agent: z.number().int().nonnegative(),
    caller: z.number().int().nonnegative(),
  }),
  /**
   * Agent share of spoken words, 0..1. Word-based rather than time-based:
   * without per-turn end times, a time split would silently charge every
   * post-turn silence to whoever spoke last. Null when nobody spoke.
   */
  talkRatio: z.number().min(0).max(1).nullable(),
  /**
   * Turns where the transcriber itself reported it could not make out the
   * speech. A direct statement that recognition failed, rather than the
   * inference `endpointing` makes — and it needs no punctuation to detect.
   */
  unclearTurnIds: z.array(z.number().int().nonnegative()),
  /**
   * Null when the source transcript carries no sentence punctuation at all —
   * the cut-off heuristic reads punctuation, so on an unpunctuated ASR dump it
   * would flag every single turn.
   */
  endpointing: endpointingMetricsSchema.nullable(),
  /**
   * Signals that the agent did not understand the caller. Three angles on the
   * same failure, because each catches calls the others miss: the caller
   * repeating themselves, the agent asking them to, and the caller left
   * talking to silence.
   */
  comprehension: z.object({
    /** Caller turns that restate an earlier caller turn. */
    repeatPairs: z.array(repetitionPairSchema),
    /** Agent turns that explicitly ask the caller to say it again. */
    agentRepeatRequestTurnIds: z.array(z.number().int().nonnegative()),
    /** Caller turns checking whether anyone is still on the line. */
    unansweredCallerTurnIds: z.array(z.number().int().nonnegative()),
    /** repeatPairs ÷ caller turns, 0..1. */
    callerRepeatRate: z.number().min(0).max(1),
  }),
})
export type TranscriptMetrics = z.infer<typeof transcriptMetricsSchema>

/** Sentence-final punctuation, allowing a trailing quote or bracket. */
const TERMINAL_PUNCTUATION = /[.!?…]["'”’)\]]*$/

/**
 * Markers transcribers emit in place of speech they could not resolve. GHL's
 * Voice AI writes the bracketed forms; the bare words appear in some provider
 * dumps we have seen pass through the same field.
 */
const UNCLEAR_AUDIO = /[[(]\s*(unintelligible|inaudible|indiscernible|crosstalk)\b/i

/**
 * The agent asking the caller to say it again. A direct admission that
 * recognition or understanding failed — higher precision than inferring the
 * same thing from how similar two caller turns are.
 */
const AGENT_REPEAT_REQUEST =
  /\b(repeat that|repeat which|say that again|come again|didn'?t (quite )?(catch|get) that|did not catch that|missed that|one more time)\b/i

/**
 * The caller checking whether anyone is still on the line. Means the agent
 * left dead air long enough for a human to notice — visible in text even
 * though the silence itself is not.
 */
const CALLER_NO_RESPONSE =
  /^(hello\??|hi\??)$|\b(are you (still )?there|can you hear me|is anyone there|you there)\b/i

/**
 * Words that leave a sentence hanging. A caller turn ending on one of these,
 * with no closing punctuation, was almost certainly still in progress.
 * Deliberately conservative — we would rather miss a cut-off than cry wolf on
 * a complete-but-unpunctuated utterance like "I need help with my account".
 */
const CONTINUATION_WORDS = new Set([
  // conjunctions / subordinators
  'and', 'but', 'or', 'so', 'because', 'cause', 'if', 'when', 'while', 'since',
  'though', 'although', 'that', 'which', 'who', 'whether',
  // prepositions
  'to', 'for', 'with', 'at', 'in', 'on', 'of', 'from', 'by', 'about', 'into',
  'over', 'under', 'like',
  // determiners
  'a', 'an', 'the', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'this',
  'these', 'those', 'some', 'any',
  // pronouns / auxiliaries mid-clause
  'i', "i'm", 'im', 'we', 'they', 'he', 'she', 'it', 'is', 'was', 'are', 'were',
  'am', 'be', 'can', 'could', 'will', 'would', 'should', 'do', 'does', 'did',
  'have', 'has', 'had', 'need', 'want', 'just', 'really', 'very',
])

/** Function words carrying no topical signal; ignored when comparing turns. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at',
  'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'my', 'your', 'that', 'this', 'do', 'does',
  'did', 'have', 'has', 'had', 'can', 'could', 'will', 'would', 'just', 'like',
  'yeah', 'yes', 'no', 'ok', 'okay', 'um', 'uh', 'well', 'then', 'there',
  'here', 'what', 'when', 'where', 'how', 'why', 'me', 'said', 'say',
])

/**
 * Content-word overlap at which two caller turns count as the same point made
 * twice. Tuned to catch a genuine re-explanation ("I need to reschedule my
 * appointment" → "I said I want to reschedule the appointment") without
 * matching two unrelated turns that share a topic word.
 */
const REPEAT_SIMILARITY = 0.6

/** Below this, a turn is too short for overlap to mean anything. */
const MIN_CONTENT_WORDS = 4

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

function contentWords(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared / (a.size + b.size - shared)
}

function endsMidSentence(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || TERMINAL_PUNCTUATION.test(trimmed)) return false
  const last = words(trimmed).at(-1)?.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
  return last !== undefined && CONTINUATION_WORDS.has(last)
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

/**
 * Compute every transcript-derivable metric in one pass over the turns.
 *
 * `system` turns (IVR notices, provider annotations) are excluded from both
 * word counts and turn counts: they are not either party talking, and folding
 * them in would skew the talk ratio toward whichever role we assigned them.
 */
export function computeTranscriptMetrics(turns: Turn[]): TranscriptMetrics {
  const agentTurns = turns.filter((t) => t.role === 'agent')
  const callerTurns = turns.filter((t) => t.role === 'caller')

  const agentWords = agentTurns.reduce((sum, t) => sum + words(t.text).length, 0)
  const callerWords = callerTurns.reduce((sum, t) => sum + words(t.text).length, 0)
  const spokenWords = agentWords + callerWords

  // --- endpointing / interruption -------------------------------------------
  // Only meaningful on a punctuated transcript; see the schema note.
  const punctuated = turns.some((t) => TERMINAL_PUNCTUATION.test(t.text.trim()))
  let endpointing: EndpointingMetrics | null = null

  if (punctuated) {
    const truncatedTurnIds: number[] = []
    const interruptedTurnIds: number[] = []

    turns.forEach((turn, index) => {
      if (turn.role !== 'caller' || !endsMidSentence(turn.text)) return
      truncatedTurnIds.push(turn.id)
      // The agent talking next is what turns "trailed off" into "spoken over".
      // System turns are skipped: a provider annotation between the two does
      // not mean the caller was left alone.
      const next = turns.slice(index + 1).find((t) => t.role !== 'system')
      if (next?.role === 'agent') interruptedTurnIds.push(turn.id)
    })

    endpointing = {
      truncatedTurnIds,
      interruptedTurnIds,
      interruptionRate: ratio(interruptedTurnIds.length, callerTurns.length),
    }
  }

  // --- comprehension ---------------------------------------------------------
  // Each caller turn is matched against the *earliest* turn it restates, so a
  // point made three times yields two pairs rather than three.
  const pairs: Array<{ firstTurnId: number; repeatedTurnId: number }> = []
  const callerContent = callerTurns.map((t) => ({ id: t.id, tokens: contentWords(t.text) }))

  for (let later = 0; later < callerContent.length; later++) {
    const current = callerContent[later]!
    if (current.tokens.size < MIN_CONTENT_WORDS) continue
    for (let earlier = 0; earlier < later; earlier++) {
      const previous = callerContent[earlier]!
      if (previous.tokens.size < MIN_CONTENT_WORDS) continue
      if (jaccard(previous.tokens, current.tokens) >= REPEAT_SIMILARITY) {
        pairs.push({ firstTurnId: previous.id, repeatedTurnId: current.id })
        break
      }
    }
  }

  return {
    turns: { total: turns.length, agent: agentTurns.length, caller: callerTurns.length },
    words: { agent: agentWords, caller: callerWords },
    talkRatio: spokenWords > 0 ? agentWords / spokenWords : null,
    unclearTurnIds: turns.filter((t) => UNCLEAR_AUDIO.test(t.text)).map((t) => t.id),
    endpointing,
    comprehension: {
      repeatPairs: pairs,
      agentRepeatRequestTurnIds: agentTurns
        .filter((t) => AGENT_REPEAT_REQUEST.test(t.text))
        .map((t) => t.id),
      unansweredCallerTurnIds: callerTurns
        .filter((t) => CALLER_NO_RESPONSE.test(t.text.trim()))
        .map((t) => t.id),
      callerRepeatRate: ratio(pairs.length, callerTurns.length),
    },
  }
}
