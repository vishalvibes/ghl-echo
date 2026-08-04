import { eq } from 'drizzle-orm'
import {
  scoreCall,
  type JudgeOutput,
  type Verdict,
} from '@copilot/shared'
import { db } from '../db/client.js'
import {
  calls,
  criterionResults,
  evaluations,
  findings as findingsTable,
  callActions,
  type AgentRow,
  type CallRow,
  type ScorecardRow,
} from '../db/schema.js'
import { activeScorecardFor } from '../services/agent-monitoring.js'
import { judgeCall } from '../scoring/judge.js'
import { isJudgeable } from './normalize.js'

/** Severity for a segment is inherited from the worst finding overlapping it. */
function segmentSeverity(output: JudgeOutput, turnStart: number, turnEnd: number): 'low' | 'medium' | 'high' {
  const order = { low: 0, medium: 1, high: 2 } as const
  let worst: 'low' | 'medium' | 'high' = 'medium'
  let found = false
  for (const finding of output.findings) {
    if (finding.turnIds.some((id) => id >= turnStart && id <= turnEnd)) {
      if (!found || order[finding.severity] > order[worst]) worst = finding.severity
      found = true
    }
  }
  return found ? worst : 'medium'
}

export interface PersistedEvaluation {
  evaluationId: string
  verdict: Verdict
  overallScore: number
}

/**
 * Write one judge output (real or fixture) as an evaluation with its child
 * rows, inside a transaction. Idempotent per (call, scorecard version): a
 * webhook redelivery that re-judges a call replaces nothing and inserts
 * nothing thanks to the unique index — we check first to avoid burning a
 * model call, but the index is the actual guarantee.
 */
export async function persistEvaluation(args: {
  call: CallRow
  agent: AgentRow
  scorecard: ScorecardRow
  output: JudgeOutput
  model: string
  latencyMs: number
  promptTokens?: number
  completionTokens?: number
}): Promise<PersistedEvaluation> {
  const { call, agent, scorecard, output } = args
  const active = scorecard.criteria.filter((c) => c.enabled)
  const breakdown = scoreCall(active, output.criteria, {
    passThreshold: scorecard.passThreshold,
    partialThreshold: scorecard.partialThreshold,
  })
  const failedEvidence = new Set(
    output.criteria
      .filter((criterion) => !criterion.met)
      .flatMap((criterion) => criterion.evidenceTurnIds),
  )
  const groundedFindings = output.findings.filter((finding) =>
    finding.turnIds.some((turnId) => failedEvidence.has(turnId)),
  )
  const groundedSegments = output.segments.filter((segment) =>
    [...failedEvidence].some((turnId) => turnId >= segment.turnStart && turnId <= segment.turnEnd),
  )
  const groundedOutput: JudgeOutput = {
    ...output,
    findings: groundedFindings,
    segments: groundedSegments,
  }

  return db.transaction(async (tx) => {
    const [evaluation] = await tx
      .insert(evaluations)
      .values({
        locationId: call.locationId,
        callId: call.id,
        agentId: agent.id,
        scorecardId: scorecard.id,
        scorecardVersion: scorecard.version,
        overallScore: breakdown.overallScore,
        verdict: breakdown.verdict,
        summary: output.summary,
        callerSentiment: output.callerSentiment,
        model: args.model,
        latencyMs: args.latencyMs,
        promptTokens: args.promptTokens ?? 0,
        completionTokens: args.completionTokens ?? 0,
        missingKeys: breakdown.missingKeys,
      })
      .returning({ id: evaluations.id })

    const evaluationId = evaluation!.id

    if (output.criteria.length > 0) {
      await tx.insert(criterionResults).values(
        output.criteria.map((c) => ({
          evaluationId,
          agentId: agent.id,
          criterionKey: c.key,
          met: c.met,
          value: c.value === null ? null : String(c.value),
          confidence: c.confidence,
          evidenceTurnIds: c.evidenceTurnIds,
          rationale: c.rationale,
        })),
      )
    }

    if (groundedFindings.length > 0) {
      await tx.insert(findingsTable).values(
        groundedFindings.map((f) => ({
          locationId: call.locationId,
          evaluationId,
          callId: call.id,
          agentId: agent.id,
          type: f.type,
          severity: f.severity,
          title: f.title,
          detail: f.detail,
          quote: f.quote,
          turnIds: f.turnIds,
        })),
      )
    }

    if (groundedSegments.length > 0) {
      await tx.insert(callActions).values(
        groundedSegments.map((s) => ({
          locationId: call.locationId,
          evaluationId,
          callId: call.id,
          agentId: agent.id,
          turnStart: s.turnStart,
          turnEnd: s.turnEnd,
          actionType: s.actionType,
          reason: s.reason,
          severity: segmentSeverity(groundedOutput, s.turnStart, s.turnEnd),
        })),
      )
    }

    await tx.update(calls).set({ ingestStatus: 'evaluated', ingestError: null }).where(eq(calls.id, call.id))

    return { evaluationId, verdict: breakdown.verdict, overallScore: breakdown.overallScore }
  })
}

/**
 * Judge and persist one pending call with the live model. The entry point the
 * call event handler calls; also used by the backfill loop.
 */
export async function evaluateCall(callId: string): Promise<PersistedEvaluation | { skipped: string }> {
  const call = await db.query.calls.findFirst({ where: eq(calls.id, callId) })
  if (!call) throw new Error(`Call not found: ${callId}`)

  const agent = await db.query.agents.findFirst({ where: (a, { eq: eqOp }) => eqOp(a.id, call.agentId) })
  if (!agent) throw new Error(`Agent not found for call ${callId}`)

  if (!isJudgeable(call.transcript)) {
    await db
      .update(calls)
      .set({ ingestStatus: 'skipped', ingestError: 'transcript too short to judge' })
      .where(eq(calls.id, call.id))
    return { skipped: 'transcript too short to judge' }
  }

  const scorecard = await activeScorecardFor(agent.id)
  if (!scorecard) {
    await db
      .update(calls)
      .set({ ingestStatus: 'skipped', ingestError: 'no active scorecard' })
      .where(eq(calls.id, call.id))
    return { skipped: 'no active scorecard' }
  }

  const existing = await db.query.evaluations.findFirst({
    where: (e, { and, eq: eqOp }) =>
      and(eqOp(e.callId, call.id), eqOp(e.scorecardVersion, scorecard.version)),
  })
  if (existing) {
    await db
      .update(calls)
      .set({ ingestStatus: 'evaluated', ingestError: null })
      .where(eq(calls.id, call.id))
    return { evaluationId: existing.id, verdict: existing.verdict, overallScore: existing.overallScore }
  }

  try {
    const result = await judgeCall({
      transcript: call.transcript,
      criteria: scorecard.criteria,
      passThreshold: scorecard.passThreshold,
      partialThreshold: scorecard.partialThreshold,
      context: {
        agentName: agent.name,
        agentPrompt: agent.promptSnapshot,
        direction: call.direction,
        durationSec: call.durationSec,
        outcome: call.outcome,
      },
    })

    return await persistEvaluation({
      call,
      agent,
      scorecard,
      output: result.output,
      model: result.model,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    })
  } catch (error) {
    await db
      .update(calls)
      .set({ ingestStatus: 'failed', ingestError: (error as Error).message.slice(0, 500) })
      .where(eq(calls.id, call.id))
    throw error
  }
}
