import { z } from 'zod'
import { callerSentimentSchema } from './evaluation.js'

/**
 * Model-assessed call quality — the judgements no amount of arithmetic can
 * make, in one schema, produced by one prompt.
 *
 * This is the counterpart to `computeTranscriptMetrics`: that module counts
 * what is countable (talk ratio, cut-off turns, repeats), this one reads what
 * has to be understood (did the caller get what they wanted, did the agent
 * follow its own script). Splitting them that way keeps the deterministic
 * numbers reproducible and free, and confines model opinion to the fields
 * that genuinely need it.
 *
 * Deliberately *not* here: response latency, dead air and true barge-in. They
 * need audio timing we do not have, and a model asked to guess them would
 * produce confident fiction. They stay absent until we have the signal.
 *
 * Scored fields use 1-5 so they mix with the scorecard's `scale` criteria.
 * Every judgement that can point at the transcript must, for the same reason
 * the judge does it: an insight the user cannot verify is noise.
 */

/** Whether the caller left with what they called for. */
export const taskOutcomeSchema = z.enum([
  'resolved',
  'partially_resolved',
  'unresolved',
  'no_intent_expressed',
])
export type TaskOutcome = z.infer<typeof taskOutcomeSchema>

/**
 * How the call ended, as far as the closing turns reveal it.
 *
 * Inferred, not measured — a transcript records no hangup event. `unclear` is
 * a first-class answer rather than a failure case: on a truncated or one-sided
 * transcript it is the only honest one, and forcing a guess would put fiction
 * in a field people will read as fact.
 */
export const callEndReasonSchema = z.enum([
  'agent_wrap_up',
  'caller_ended',
  'transferred',
  'voicemail',
  'cut_off',
  'unclear',
])
export type CallEndReason = z.infer<typeof callEndReasonSchema>

const scoreSchema = z.number().int().min(1).max(5)
const turnIdsSchema = z.array(z.number().int().nonnegative())

export const missedOpportunitySchema = z.object({
  /** The thing the agent should have done, as a short phrase. */
  action: z.string().min(1).max(90),
  evidenceTurnIds: turnIdsSchema,
})
export type MissedOpportunity = z.infer<typeof missedOpportunitySchema>

export const callQualitySchema = z.object({
  /**
   * Did the call finish the job — yes or no.
   *
   * Answerable without knowing the account's success criteria: it asks whether
   * the conversation reached a natural end with its business done, not whether
   * it hit a target the operator never told us about. `outcome.result` carries
   * the nuance; this is the binary the dashboard counts.
   */
  callCompleted: z.boolean(),
  outcome: z.object({
    result: taskOutcomeSchema,
    /** One sentence justifying the result, citing what happened. */
    reason: z.string().min(1),
    /**
     * Optional because the outcome is a whole-call judgement that does not
     * always land on specific turns — and because a field the model may omit
     * must never be the thing that fails the whole assessment.
     */
    evidenceTurnIds: turnIdsSchema.default([]),
  }),
  /** How closely the agent followed the script it was given. */
  scriptAdherence: z.object({
    score: scoreSchema,
    /**
     * Steps the agent's own prompt required but the call never covered, as
     * short phrases. Length-capped because the model will otherwise quote the
     * script back verbatim, turning a scannable list into a wall of prose.
     */
    missedSteps: z.array(z.string().min(1).max(60)).max(6),
    evidenceTurnIds: turnIdsSchema,
  }),
  /** Whether the agent actually understood the caller. */
  comprehension: z.object({
    score: scoreSchema,
    /** Turns where the agent misread or ignored what the caller said. */
    misunderstoodTurnIds: turnIdsSchema,
  }),
  /**
   * Tone as far as *wording* reveals it. Prosody is not in a transcript, so
   * this reads politeness, acknowledgement and pushiness — not warmth of voice.
   */
  tone: z.object({
    score: scoreSchema,
    note: z.string().min(1),
  }),
  /**
   * How the caller sounded by the end, in words. Reuses the judge's enum so a
   * call scored by both never reports two different sentiments in two places.
   */
  callerSentiment: callerSentimentSchema,
  /**
   * True when the call ended before its business was finished — the caller hung
   * up mid-exchange, or the agent closed while something was still open. A
   * clean goodbye after an unresolved request is not premature; an abrupt stop
   * mid-sentence is.
   */
  prematureHangup: z.boolean(),
  /** Who or what ended the call. `unclear` when the transcript does not say. */
  callEndReason: callEndReasonSchema,
  /** Contact details the agent successfully collected during the call. */
  informationCaptured: z.object({
    name: z.boolean(),
    email: z.boolean(),
    phone: z.boolean(),
  }),
  /** Things worth doing that the agent did not do. Empty on a clean call. */
  missedOpportunities: z.array(missedOpportunitySchema),
  /**
   * Two to four terse phrases saying what actually happened on this call.
   * Kept short because the UI uses them as scan labels, not prose.
   */
  insights: z.array(z.string().min(1).max(40)).max(4),
})
export type CallQuality = z.infer<typeof callQualitySchema>
