import { describe, expect, it } from 'vitest'
import type { JudgeOutput, Turn } from '@copilot/shared'
import { findUnknownKeys, sanitizeJudgeOutput } from './judge.js'

const transcript: Turn[] = [
  { id: 0, role: 'agent', text: 'Hello', startMs: null },
  { id: 1, role: 'caller', text: 'Hi', startMs: null },
  { id: 2, role: 'agent', text: 'Bye', startMs: null },
]

function output(over: Partial<JudgeOutput>): JudgeOutput {
  return {
    summary: 'test',
    callerSentiment: 'neutral',
    criteria: [],
    findings: [],
    segments: [],
    ...over,
  }
}

describe('sanitizeJudgeOutput', () => {
  it('strips hallucinated evidence turn ids', () => {
    const result = sanitizeJudgeOutput(
      output({
        criteria: [
          { key: 'a', met: true, value: null, confidence: 0.9, evidenceTurnIds: [0, 7, 99], rationale: '' },
        ],
      }),
      transcript,
    )
    expect(result.criteria[0]?.evidenceTurnIds).toEqual([0])
  })

  it('strips invalid finding turn ids but keeps the finding', () => {
    const result = sanitizeJudgeOutput(
      output({
        findings: [
          { type: 'missed_goal', severity: 'high', title: 't', detail: 'd', quote: null, turnIds: [42] },
        ],
      }),
      transcript,
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.turnIds).toEqual([])
  })

  it('drops segments starting on a nonexistent turn', () => {
    const result = sanitizeJudgeOutput(
      output({
        segments: [{ turnStart: 9, turnEnd: 10, actionType: 'script_gap', reason: 'r' }],
      }),
      transcript,
    )
    expect(result.segments).toHaveLength(0)
  })

  it('clamps a segment end that runs past the transcript', () => {
    const result = sanitizeJudgeOutput(
      output({
        segments: [{ turnStart: 1, turnEnd: 99, actionType: 'script_gap', reason: 'r' }],
      }),
      transcript,
    )
    expect(result.segments[0]).toMatchObject({ turnStart: 1, turnEnd: 2 })
  })

  it('repairs an inverted segment range instead of storing it', () => {
    const result = sanitizeJudgeOutput(
      output({
        segments: [{ turnStart: 2, turnEnd: 0, actionType: 'script_gap', reason: 'r' }],
      }),
      transcript,
    )
    expect(result.segments[0]).toMatchObject({ turnStart: 2, turnEnd: 2 })
  })
})

describe('findUnknownKeys', () => {
  it('reports criteria the judge invented', () => {
    const judged = output({
      criteria: [
        { key: 'real', met: true, value: null, confidence: 1, evidenceTurnIds: [], rationale: '' },
        { key: 'invented', met: true, value: null, confidence: 1, evidenceTurnIds: [], rationale: '' },
      ],
    })
    const criteria = [
      { key: 'real', label: 'Real', type: 'boolean' as const, weight: 1, definition: 'x', failWhen: null, enabled: true },
    ]
    expect(findUnknownKeys(judged, criteria)).toEqual(['invented'])
  })
})
