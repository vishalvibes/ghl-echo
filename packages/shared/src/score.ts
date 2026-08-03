import type { Criterion } from './scorecard.js'
import type { CriterionResult, Verdict } from './evaluation.js'

/** 1..5 graded answers map onto 0..1 so they mix with boolean criteria. */
const SCALE_MIN = 1
const SCALE_MAX = 5

function normalize(criterion: Criterion, result: CriterionResult): number {
  if (criterion.type === 'scale' && typeof result.value === 'number') {
    const clamped = Math.min(Math.max(result.value, SCALE_MIN), SCALE_MAX)
    return (clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)
  }
  return result.met ? 1 : 0
}

export interface ScoreBreakdown {
  overallScore: number
  verdict: Verdict
  /** Enabled criteria the judge did not return. Counted as 0, surfaced in UI. */
  missingKeys: string[]
  perCriterion: Array<{ key: string; weight: number; normalized: number }>
}

/**
 * Compute the overall score from criterion judgements and scorecard weights.
 *
 * Kept out of the model on purpose — the same judge output must always yield
 * the same number, and reviewers need to be able to recompute it by hand.
 * Disabled criteria are excluded entirely; enabled-but-unjudged criteria
 * count as zero and are reported in `missingKeys` rather than silently
 * dropped, because a judge that skips a criterion is a signal, not a no-op.
 */
export function scoreCall(
  criteria: Criterion[],
  results: CriterionResult[],
  thresholds: { passThreshold: number; partialThreshold: number },
): ScoreBreakdown {
  const byKey = new Map(results.map((r) => [r.key, r]))
  const active = criteria.filter((c) => c.enabled)

  const missingKeys: string[] = []
  const perCriterion: ScoreBreakdown['perCriterion'] = []
  let weighted = 0
  let totalWeight = 0

  for (const criterion of active) {
    const result = byKey.get(criterion.key)
    if (!result) missingKeys.push(criterion.key)
    const normalized = result ? normalize(criterion, result) : 0
    weighted += normalized * criterion.weight
    totalWeight += criterion.weight
    perCriterion.push({ key: criterion.key, weight: criterion.weight, normalized })
  }

  const overallScore = totalWeight === 0 ? 0 : Math.round((weighted / totalWeight) * 100)
  const verdict: Verdict =
    overallScore >= thresholds.passThreshold
      ? 'pass'
      : overallScore >= thresholds.partialThreshold
        ? 'partial'
        : 'fail'

  return { overallScore, verdict, missingKeys, perCriterion }
}
