import { describe, expect, it } from 'vitest'
import { scoreCall } from './score.js'
import type { Criterion } from './scorecard.js'
import type { CriterionResult } from './evaluation.js'

function criterion(over: Partial<Criterion> & Pick<Criterion, 'key'>): Criterion {
  return {
    label: over.key,
    type: 'boolean',
    weight: 1,
    definition: 'test',
    failWhen: null,
    enabled: true,
    ...over,
  }
}

function result(over: Partial<CriterionResult> & Pick<CriterionResult, 'key'>): CriterionResult {
  return {
    met: true,
    value: null,
    confidence: 1,
    evidenceTurnIds: [],
    rationale: '',
    ...over,
  }
}

const thresholds = { passThreshold: 70, partialThreshold: 40 }

describe('scoreCall', () => {
  it('weights criteria rather than averaging them', () => {
    const criteria = [
      criterion({ key: 'booked', weight: 3 }),
      criterion({ key: 'greeted', weight: 1 }),
    ]
    const results = [result({ key: 'booked', met: false }), result({ key: 'greeted', met: true })]

    // 1 of 4 weight points earned — a plain average would have said 50.
    expect(scoreCall(criteria, results, thresholds).overallScore).toBe(25)
  })

  it('normalizes 1..5 scale criteria onto 0..1', () => {
    const criteria = [criterion({ key: 'tone', type: 'scale' })]
    expect(scoreCall(criteria, [result({ key: 'tone', value: 4 })], thresholds).overallScore).toBe(75)
    expect(scoreCall(criteria, [result({ key: 'tone', value: 1 })], thresholds).overallScore).toBe(0)
  })

  it('clamps out-of-range scale values instead of exceeding 100', () => {
    const criteria = [criterion({ key: 'tone', type: 'scale' })]
    expect(scoreCall(criteria, [result({ key: 'tone', value: 9 })], thresholds).overallScore).toBe(100)
  })

  it('counts unjudged criteria as zero and reports them', () => {
    const criteria = [criterion({ key: 'booked' }), criterion({ key: 'emailed' })]
    const breakdown = scoreCall(criteria, [result({ key: 'booked' })], thresholds)

    expect(breakdown.overallScore).toBe(50)
    expect(breakdown.missingKeys).toEqual(['emailed'])
  })

  it('excludes disabled criteria from the denominator', () => {
    const criteria = [criterion({ key: 'booked' }), criterion({ key: 'old_kpi', enabled: false })]
    const breakdown = scoreCall(criteria, [result({ key: 'booked' })], thresholds)

    expect(breakdown.overallScore).toBe(100)
    expect(breakdown.missingKeys).toEqual([])
  })

  it('maps scores onto pass / partial / fail at the thresholds', () => {
    const criteria = [criterion({ key: 'tone', type: 'scale' })]
    const verdictFor = (value: number) =>
      scoreCall(criteria, [result({ key: 'tone', value })], thresholds).verdict

    expect(verdictFor(5)).toBe('pass') // 100
    expect(verdictFor(4)).toBe('pass') // 75
    expect(verdictFor(3)).toBe('partial') // 50
    expect(verdictFor(2)).toBe('fail') // 25
  })

  it('returns zero rather than dividing by zero when nothing is enabled', () => {
    const criteria = [criterion({ key: 'booked', enabled: false })]
    const breakdown = scoreCall(criteria, [], thresholds)

    expect(breakdown.overallScore).toBe(0)
    expect(breakdown.verdict).toBe('fail')
  })
})
