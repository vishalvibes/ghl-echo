import { z } from 'zod'

/**
 * Observability parameters for one Voice AI agent.
 *
 * A scorecard is the user-authored definition of "did this call go well".
 * It is versioned and immutable once evaluations reference it: editing
 * criteria mints a new version, and old evaluations keep pointing at the
 * version they were scored under. Without that, a criteria tweak would
 * silently rewrite history and every trend line would lie.
 */

export const criterionTypeSchema = z.enum([
  /** Did it happen or not. Scored 0 or 1. */
  'boolean',
  /** Graded 1..5 judgement, e.g. tone. Normalized to 0..1. */
  'scale',
  /** Pull a value out of the call (email, budget). Present = 1, absent = 0. */
  'extraction',
])
export type CriterionType = z.infer<typeof criterionTypeSchema>

export const criterionSchema = z.object({
  /** snake_case, stable across versions — the join key for trend lines. */
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'key must be lower_snake_case'),
  label: z.string().min(1).max(120),
  type: criterionTypeSchema,
  /** Relative importance in the weighted overall score. */
  weight: z.number().int().min(1).max(5).default(1),
  /** Prose fed verbatim to the judge model. The whole KPI lives here. */
  definition: z.string().min(1).max(1000),
  /** Optional explicit failure condition — sharpens borderline judgements. */
  failWhen: z.string().max(1000).nullable().default(null),
  enabled: z.boolean().default(true),
})
export type Criterion = z.infer<typeof criterionSchema>

export const scorecardSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  version: z.number().int().positive(),
  /** Weighted score at or above which a call counts as a pass. */
  passThreshold: z.number().int().min(0).max(100).default(70),
  /** Below this, the call is a hard fail rather than "partial". */
  partialThreshold: z.number().int().min(0).max(100).default(40),
  criteria: z.array(criterionSchema).min(1).max(20),
  createdAt: z.iso.datetime(),
})
export type Scorecard = z.infer<typeof scorecardSchema>

/** Body accepted when saving a new scorecard version. */
export const scorecardDraftSchema = scorecardSchema
  .pick({ passThreshold: true, partialThreshold: true, criteria: true })
  .refine((s) => s.partialThreshold < s.passThreshold, {
    message: 'partialThreshold must be below passThreshold',
    path: ['partialThreshold'],
  })
export type ScorecardDraft = z.infer<typeof scorecardDraftSchema>
