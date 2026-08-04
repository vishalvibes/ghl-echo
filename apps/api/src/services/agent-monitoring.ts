import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { ScorecardDraft } from '@copilot/shared'
import { EVENT_TRANSCRIPT_RECEIVED, inngestClient } from '../clients/inngest.js'
import { db } from '../db/client.js'
import { calls, scorecards, type ScorecardRow } from '../db/schema.js'

export type MonitoringState = 'monitoring' | 'paused'

export interface AgentMonitoringSnapshot {
  configured: boolean
  state: MonitoringState | 'not_configured'
  scorecard: ScorecardRow | null
  processingCalls: number
}

/** Save a new immutable scorecard version, activate it, then evaluate recent calls. */
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

  const queuedCalls = await queueRecentCalls(args.agentId, nextVersion)
  return { scorecard: created!, queuedCalls }
}

/** Pause or resume an already-configured agent without deleting its criteria. */
export async function setAgentMonitoringState(
  agentId: string,
  state: MonitoringState,
): Promise<AgentMonitoringSnapshot | null> {
  const latest = await latestScorecardFor(agentId)
  if (!latest) return null

  await db.transaction(async (tx) => {
    await tx.update(scorecards).set({ isActive: false }).where(eq(scorecards.agentId, agentId))
    if (state === 'monitoring') {
      await tx.update(scorecards).set({ isActive: true }).where(eq(scorecards.id, latest.id))
    }
  })

  if (state === 'monitoring') await queueRecentCalls(agentId, latest.version)

  return getAgentMonitoringSnapshot(agentId)
}

export async function getAgentMonitoringSnapshot(agentId: string): Promise<AgentMonitoringSnapshot> {
  const [latest, active, processingRow] = await Promise.all([
    latestScorecardFor(agentId),
    activeScorecardFor(agentId),
    db
      .select({ value: count() })
      .from(calls)
      .where(and(eq(calls.agentId, agentId), eq(calls.ingestStatus, 'pending')))
      .then((rows) => rows[0]?.value ?? 0),
  ])

  return {
    configured: latest !== null,
    state: latest === null ? 'not_configured' : active ? 'monitoring' : 'paused',
    scorecard: latest,
    processingCalls: active ? processingRow : 0,
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
  const rows = await db.query.scorecards.findMany({
    where: and(eq(scorecards.agentId, agentId), eq(scorecards.isActive, true)),
    orderBy: (sc, { desc: descOp }) => [descOp(sc.version)],
    limit: 1,
  })
  return rows[0] ?? null
}

async function queueRecentCalls(agentId: string, scorecardVersion: number): Promise<number> {
  const recent = await db.query.calls.findMany({
    where: and(eq(calls.agentId, agentId), eq(calls.outcome, 'completed')),
    orderBy: [desc(calls.startedAt)],
    columns: { id: true },
    limit: 50,
  })
  const callIds = recent.map((call) => call.id)
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
