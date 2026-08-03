import { z } from 'zod'

/**
 * A single utterance in a call, after normalization.
 *
 * `id` is the stable anchor everything else points at: findings, criterion
 * evidence and "use action" segments all reference turn ids rather than
 * character offsets, so highlighting survives re-rendering and re-scoring.
 * Ids are assigned by the normalizer as the 0-based index within the call.
 */
export const turnRoleSchema = z.enum(['agent', 'caller', 'system'])
export type TurnRole = z.infer<typeof turnRoleSchema>

export const turnSchema = z.object({
  id: z.number().int().nonnegative(),
  role: turnRoleSchema,
  text: z.string(),
  /** Offset from call start. Null when the source only gives us ordering. */
  startMs: z.number().int().nonnegative().nullable().default(null),
})
export type Turn = z.infer<typeof turnSchema>

export const transcriptSchema = z.array(turnSchema)
export type Transcript = z.infer<typeof transcriptSchema>

export const callDirectionSchema = z.enum(['inbound', 'outbound'])
export type CallDirection = z.infer<typeof callDirectionSchema>

/** Whether the telephony layer connected at all — distinct from KPI verdict. */
export const callOutcomeSchema = z.enum([
  'completed',
  'no_answer',
  'voicemail',
  'busy',
  'failed',
])
export type CallOutcome = z.infer<typeof callOutcomeSchema>
