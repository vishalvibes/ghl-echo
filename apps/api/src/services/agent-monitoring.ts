import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { ScorecardDraft } from '@copilot/shared'
import { EVENT_TRANSCRIPT_RECEIVED, inngestClient } from '../clients/inngest.js'
import { db } from '../db/client.js'
import { calls, scorecards, type ScorecardRow } from '../db/schema.js'

export interface AgentMonitoringSnapshot {
  configured: boolean
  scorecard: ScorecardRow | null
  processingCalls: number
}

/** Save a new immutable scorecard version, activate it, then evaluate existing calls. */
export async function saveAgentScorecard(args: {
  locationId: string
  agentId: string
  draft: ScorecardDraft
}): Promise<{ scorecard: ScorecardRow; queuedCalls: number }> {
  const latest = await latestScorecardFor(args.agentId)
  const nextVersion = (latest?.version ?? 0) + 1

  const [created] = await db.transaction(async (tx) => {
    await tx
      .update(scorecards)
      .set({ isActive: false })
      .where(and(eq(scorecards.agentId, args.agentId), eq(scorecards.isActive, true)))

    return tx
      .insert(scorecards)
      .values({
        locationId: args.locationId,
        agentId: args.agentId,
        version: nextVersion,
        passThreshold: args.draft.passThreshold,
        partialThreshold: args.draft.partialThreshold,
        criteria: args.draft.criteria,
      })
      .returning()
  })

  const queuedCalls = await queueExistingCalls(args.agentId, nextVersion)
  return { scorecard: created!, queuedCalls }
}

export async function getAgentMonitoringSnapshot(agentId: string): Promise<AgentMonitoringSnapshot> {
  const [latest, processingRow] = await Promise.all([
    latestScorecardFor(agentId),
    db
      .select({ value: count() })
      .from(calls)
      .where(and(eq(calls.agentId, agentId), eq(calls.ingestStatus, 'pending')))
      .then((rows) => rows[0]?.value ?? 0),
  ])

  return {
    configured: latest !== null,
    scorecard: latest,
    processingCalls: processingRow,
  }
}

export async function latestScorecardFor(agentId: string): Promise<ScorecardRow | null> {
  const rows = await db.query.scorecards.findMany({
    where: eq(scorecards.agentId, agentId),
    orderBy: (sc, { desc: descOp }) => [descOp(sc.version)],
    limit: 1,
  })
  return rows[0] ?? null
}

export async function activeScorecardFor(agentId: string): Promise<ScorecardRow | null> {
  // Monitoring cannot be paused. The newest scorecard is always the custom
  // criteria layer, including rows created before the pause control was
  // removed and left inactive.
  return latestScorecardFor(agentId)
}

async function queueExistingCalls(agentId: string, scorecardVersion: number): Promise<number> {
  const existing = await db.query.calls.findMany({
    where: and(
      eq(calls.agentId, agentId),
      eq(calls.outcome, 'completed'),
    ),
    orderBy: [desc(calls.startedAt)],
    columns: { id: true },
  })
  const callIds = existing.map((call) => call.id)
  if (callIds.length === 0) return 0

  await db
    .update(calls)
    .set({ ingestStatus: 'pending', ingestError: null })
    .where(inArray(calls.id, callIds))

  await inngestClient.send(
    callIds.map((callId) => ({
      name: EVENT_TRANSCRIPT_RECEIVED,
      data: {
        callId,
        processingKey: `scorecard:${scorecardVersion}:${callId}`,
      },
    })),
  )
  return callIds.length
}
