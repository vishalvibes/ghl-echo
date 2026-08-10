import { describe, expect, it } from 'vitest'
import {
  agentTestingJobSchema,
  confirmEdgeCasesSchema,
  expandedTestCaseSchema,
  proposedEdgeCasesSchema,
  agentGoalsSchema,
  testCaseListSchema,
  testCaseSchema,
} from './api.js'

describe('agent testing schemas', () => {
  it('accepts goals and proposed edge cases', () => {
    expect(agentGoalsSchema.parse({ goals: ['Book discovery calls'] }).goals).toHaveLength(1)
    expect(
      proposedEdgeCasesSchema.parse({
        edgeCases: ['Caller refuses SMS consent and agent keeps pushing.'],
      }).edgeCases,
    ).toHaveLength(1)
  })

  it('accepts confirm payload and expanded multi-transcript shape', () => {
    expect(
      confirmEdgeCasesSchema.parse({
        edgeCases: ['Caller never gives a business type.'],
      }).edgeCases[0],
    ).toContain('business type')

    const expanded = expandedTestCaseSchema.parse({
      scenario: [
        'Caller is a new lead asking about missed-call follow-ups.',
        'Caller declines to name their business type.',
      ],
      criteria: [
        {
          key: 'asked_business_type',
          label: 'Asked for business type',
          description: 'Agent asked for business type before booking.',
        },
      ],
      transcripts: [
        {
          expectedOutcome: 'fail',
          expectedFailedCriteria: ['asked_business_type'],
          turns: [
            { id: 0, role: 'agent', text: 'Hi, how can I help?', startMs: null },
            { id: 1, role: 'caller', text: 'Just book me something.', startMs: null },
          ],
        },
        {
          expectedOutcome: 'pass',
          expectedFailedCriteria: [],
          turns: [
            { id: 0, role: 'agent', text: 'Thanks for calling.', startMs: null },
            { id: 1, role: 'caller', text: 'I need follow-ups.', startMs: null },
            { id: 2, role: 'agent', text: 'Great — what industry are you in?', startMs: null },
            { id: 3, role: 'caller', text: 'Prefer not to say.', startMs: null },
          ],
        },
      ],
    })
    expect(expanded.criteria).toHaveLength(1)
    expect(expanded.transcripts).toHaveLength(2)
    expect(expanded.scenario).toHaveLength(2)
  })

  it('allows an exceptional all-pass pack when every transcript earns it', () => {
    const result = expandedTestCaseSchema.safeParse({
      scenario: ['Caller asks for help.', 'Agent responds.'],
      criteria: [
        { key: 'offers_help', label: 'Offers help', description: 'Agent offers useful help.' },
      ],
      transcripts: [
        {
          expectedOutcome: 'pass',
          expectedFailedCriteria: [],
          turns: [
            { id: 0, role: 'caller', text: 'Can you help?', startMs: null },
            { id: 1, role: 'agent', text: 'Yes.', startMs: null },
          ],
        },
        {
          expectedOutcome: 'pass',
          expectedFailedCriteria: [],
          turns: [
            { id: 0, role: 'caller', text: 'Can you help?', startMs: null },
            { id: 1, role: 'agent', text: 'Absolutely.', startMs: null },
          ],
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('allows an exceptional all-fail pack when the prompt lacks the behavior', () => {
    const result = expandedTestCaseSchema.safeParse({
      scenario: ['Caller asks for help.', 'Agent refuses twice.'],
      criteria: [
        { key: 'offers_help', label: 'Offers help', description: 'Agent offers useful help.' },
      ],
      transcripts: [
        {
          expectedOutcome: 'fail',
          expectedFailedCriteria: ['offers_help'],
          turns: [
            { id: 0, role: 'caller', text: 'Can you help?', startMs: null },
            { id: 1, role: 'agent', text: 'No.', startMs: null },
          ],
        },
        {
          expectedOutcome: 'fail',
          expectedFailedCriteria: ['offers_help'],
          turns: [
            { id: 0, role: 'caller', text: 'I need assistance.', startMs: null },
            { id: 1, role: 'agent', text: 'I cannot help.', startMs: null },
          ],
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a serialized test case list item', () => {
    const row = testCaseSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      agentId: '22222222-2222-4222-8222-222222222222',
      edgeCase: 'Short edge',
      scenario: ['Step one', 'Step two'],
      criteria: [
        {
          key: 'greeted',
          label: 'Greeted',
          description: 'Agent greeted the caller.',
        },
      ],
      transcripts: [[{ id: 0, role: 'agent', text: 'Hello', startMs: null }, { id: 1, role: 'caller', text: 'Hi', startMs: null }]],
      results: null,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
    })
    expect(row.results).toBeNull()
    expect(row.transcripts).toHaveLength(1)
  })

  it('accepts a testing job and list payload with job', () => {
    const job = agentTestingJobSchema.parse({
      id: '33333333-3333-4333-8333-333333333333',
      type: 'run',
      status: 'running',
      progress: { done: 2, total: 8, label: 'Judging mock 2/8' },
      error: null,
      suggestion: null,
      updatedAt: new Date().toISOString(),
    })
    expect(job.progress.done).toBe(2)

    const list = testCaseListSchema.parse({
      goals: ['Book calls'],
      prompt: 'Be helpful.',
      testCases: [],
      testingJob: job,
    })
    expect(list.testingJob?.type).toBe('run')
  })
})
