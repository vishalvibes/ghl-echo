import { z } from 'zod'

/**
 * The judge model's output contract.
 *
 * Deliberately narrow: the model reports per-criterion judgements with
 * evidence, plus findings and segments. It does NOT report the overall score
 * — that is computed from the scorecard weights in `score.ts` so the number
 * is reproducible, auditable, and immune to the model's arithmetic.
 */

export const criterionResultSchema = z.object({
  key: z.string(),
  /** Pass/fail for this criterion. For `scale`, derived from `value`. */
  met: z.boolean(),
  /** Raw graded value for `scale` (1..5) or extracted string; else null. */
  value: z.union([z.number(), z.string()]).nullable().default(null),
  /** Judge's self-reported certainty. Low confidence surfaces in the UI. */
  confidence: z.number().min(0).max(1),
  /** Turn ids that justify the judgement. Drives transcript highlighting. */
  evidenceTurnIds: z.array(z.number().int().nonnegative()).default([]),
  /** One sentence, shown verbatim next to the criterion. */
  rationale: z.string().max(500),
})
export type CriterionResult = z.infer<typeof criterionResultSchema>

export const findingSeveritySchema = z.enum(['low', 'medium', 'high'])
export type FindingSeverity = z.infer<typeof findingSeveritySchema>

/** Failure taxonomy. Fixed set so the dashboard can aggregate across calls. */
export const findingTypeSchema = z.enum([
  'missed_goal',
  'objection_unhandled',
  'incorrect_information',
  'compliance_risk',
  'poor_listening',
  'abrupt_ending',
  'missed_upsell',
  'escalation_needed',
])
export type FindingType = z.infer<typeof findingTypeSchema>

export const findingSchema = z.object({
  type: findingTypeSchema,
  severity: findingSeveritySchema,
  title: z.string().max(120),
  detail: z.string().max(800),
  /** Verbatim excerpt. Must appear in one of `turnIds` — validated on ingest. */
  quote: z.string().max(500).nullable().default(null),
  turnIds: z.array(z.number().int().nonnegative()).default([]),
})
export type Finding = z.infer<typeof findingSchema>

/** "Use Actions" — call spans a human should look at or train on. */
export const segmentActionSchema = z.enum([
  'human_followup',
  'script_gap',
  'objection_lost',
  'compliance_review',
  'training_example',
])
export type SegmentAction = z.infer<typeof segmentActionSchema>

export const segmentSchema = z.object({
  turnStart: z.number().int().nonnegative(),
  turnEnd: z.number().int().nonnegative(),
  actionType: segmentActionSchema,
  reason: z.string().max(400),
})
export type Segment = z.infer<typeof segmentSchema>

export const callerSentimentSchema = z.enum(['positive', 'neutral', 'negative'])
export type CallerSentiment = z.infer<typeof callerSentimentSchema>

/** Exactly what the judge model must return. Retried once on parse failure. */
export const judgeOutputSchema = z.object({
  summary: z.string().max(600),
  callerSentiment: callerSentimentSchema,
  criteria: z.array(criterionResultSchema),
  findings: z.array(findingSchema).max(10).default([]),
  segments: z.array(segmentSchema).max(10).default([]),
})
export type JudgeOutput = z.infer<typeof judgeOutputSchema>

export const verdictSchema = z.enum(['pass', 'partial', 'fail'])
export type Verdict = z.infer<typeof verdictSchema>

/** A stored evaluation: judge output plus the numbers we derived from it. */
export const evaluationSchema = judgeOutputSchema.extend({
  id: z.uuid(),
  callId: z.uuid(),
  scorecardVersion: z.number().int().positive(),
  overallScore: z.number().int().min(0).max(100),
  verdict: verdictSchema,
  model: z.string(),
  latencyMs: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
})
export type Evaluation = z.infer<typeof evaluationSchema>
