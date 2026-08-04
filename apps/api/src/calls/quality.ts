import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { agents, calls, scorecards, type AgentRow, type CallRow } from '../db/schema.js'
import { assessCallQuality, sanitizeQuality } from '../scoring/quality.js'

/**
 * Persist the model's quality read for one call.
 *
 * Runs ahead of the scorecard judge after agent setup. A row that already
 * carries `quality` is left alone rather than re-billed.
 */
export async function assessQuality(
  call: CallRow,
  agent: AgentRow,
): Promise<{ assessed: boolean; reason?: string }> {
  if (call.quality) return { assessed: false, reason: 'already assessed' }
  // Deliberately NOT `isJudgeable`. That gate protects the scorecard judge,
  // which has nothing to weigh criteria against on a stub. Quality asks a
  // different question — did this call finish, how did the caller sound — and
  // a three-second "Hey there / Also / my name is" is precisely the call where
  // the answer is both obvious and worth recording. The only transcript we
  // cannot read is an empty one.
  if (!call.transcript.some((turn) => turn.text.trim().length > 0)) {
    return { assessed: false, reason: 'empty transcript' }
  }

  const result = await assessCallQuality({
    transcript: call.transcript,
    agentScript: agent.promptSnapshot,
    agentName: agent.name,
  })

  const quality = sanitizeQuality(result.data, call.transcript)
  await db
    .update(calls)
    .set({ quality })
    .where(eq(calls.id, call.id))

  return { assessed: true }
}

/** Event-handler entry point: reload durable rows inside the retryable step. */
export async function assessQualityCall(callId: string) {
  const call = await db.query.calls.findFirst({ where: eq(calls.id, callId) })
  if (!call) throw new Error(`Call not found: ${callId}`)
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, call.agentId) })
  if (!agent) throw new Error(`Agent not found for call ${callId}`)

  // Agent setup is the activation boundary for every model-driven assessment.
  // We still retain the transcript and deterministic mechanics, but Echo does
  // not interpret the call until the user has defined what success means.
  const scorecard = await db.query.scorecards.findFirst({
    where: (sc, { and, eq: eqOp }) => and(eqOp(sc.agentId, agent.id), eqOp(sc.isActive, true)),
    columns: { id: true },
  })
  if (!scorecard) return { assessed: false, reason: 'agent not configured' }

  return assessQuality(call, agent)
}
