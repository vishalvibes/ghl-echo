import { eq } from 'drizzle-orm'
import { closeDb, db } from './client.js'
import { agents, calls, locations, scorecards } from './schema.js'
import { FIXTURE_AGENTS } from '../fixtures/agents.js'
import { FIXTURE_CALLS } from '../fixtures/calls.js'
import { persistEvaluation } from '../calls/evaluate.js'
import { computeTranscriptMetrics } from '@copilot/shared'

/**
 * Seed a demo location with fixture agents, scorecards, calls and — because
 * the fixtures carry hand-written judge outputs — full evaluations. The
 * result is a dashboard that works end to end with no GHL account and no
 * OpenAI key.
 *
 * Idempotent: re-running finds the existing demo location and only inserts
 * calls whose ghl_call_id is missing.
 */

export const DEMO_LOCATION_GHL_ID = 'demo-location'

/** Deterministic pseudo-random — same seed data on every machine. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

function startedAtFor(daysAgo: number, random: () => number): Date {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(9 + Math.floor(random() * 9), Math.floor(random() * 60), 0, 0)
  return date
}

export async function seed(): Promise<void> {
  // 1. Demo location
  let location = await db.query.locations.findFirst({
    where: eq(locations.ghlLocationId, DEMO_LOCATION_GHL_ID),
  })
  if (!location) {
    ;[location] = await db
      .insert(locations)
      .values({ ghlLocationId: DEMO_LOCATION_GHL_ID, name: 'Demo Location' })
      .returning()
  }
  const locationId = location!.id

  // 2. Agents + scorecards
  const agentIdByKey = new Map<string, string>()
  for (const fixture of FIXTURE_AGENTS) {
    let agent = await db.query.agents.findFirst({
      where: (a, { and, eq: eqOp }) =>
        and(eqOp(a.locationId, locationId), eqOp(a.ghlAgentId, fixture.ghlAgentId)),
    })
    if (!agent) {
      ;[agent] = await db
        .insert(agents)
        .values({
          locationId,
          ghlAgentId: fixture.ghlAgentId,
          name: fixture.name,
          promptSnapshot: fixture.prompt,
          promptSyncedAt: new Date(),
        })
        .returning()
      await db.insert(scorecards).values({
        locationId,
        agentId: agent!.id,
        version: 1,
        passThreshold: fixture.passThreshold,
        partialThreshold: fixture.partialThreshold,
        criteria: fixture.criteria,
      })
    }
    agentIdByKey.set(fixture.key, agent!.id)
  }

  // 3. Calls + fixture evaluations
  const random = lcg(7)
  let inserted = 0
  for (const fixture of FIXTURE_CALLS.slice(0, 3)) {
    const agentId = agentIdByKey.get(fixture.agentKey)
    if (!agentId) throw new Error(`Fixture call references unknown agent: ${fixture.agentKey}`)

    const existing = await db.query.calls.findFirst({
      where: (c, { and, eq: eqOp }) =>
        and(eqOp(c.locationId, locationId), eqOp(c.ghlCallId, fixture.ghlCallId)),
    })
    if (existing) continue

    const metrics = computeTranscriptMetrics(fixture.transcript)
    const [call] = await db
      .insert(calls)
      .values({
        locationId,
        agentId,
        ghlCallId: fixture.ghlCallId,
        contactName: fixture.contactName,
        contactPhone: fixture.contactPhone,
        direction: fixture.direction,
        outcome: fixture.outcome,
        startedAt: startedAtFor(fixture.daysAgo, random),
        durationSec: fixture.durationSec,
        transcript: fixture.transcript,
        metrics,
        isMock: true,
      })
      .returning()

    const agent = await db.query.agents.findFirst({ where: (a, { eq: eqOp }) => eqOp(a.id, agentId) })
    const scorecard = await db.query.scorecards.findFirst({
      where: (sc, { and, eq: eqOp }) => and(eqOp(sc.agentId, agentId), eqOp(sc.isActive, true)),
      orderBy: (sc, { desc }) => [desc(sc.version)],
    })
    if (!agent || !scorecard) throw new Error(`Seed invariant broken for agent ${fixture.agentKey}`)

    await persistEvaluation({
      call: call!,
      agent,
      scorecard,
      output: fixture.judgeOutput,
      model: 'fixture',
      latencyMs: 0,
    })
    inserted++
  }

  console.log(`Seed complete: ${inserted} new calls evaluated (location ${DEMO_LOCATION_GHL_ID}).`)
}

const isDirectRun = process.argv[1]?.endsWith('seed.ts') ?? false
if (isDirectRun) {
  seed()
    .catch((error) => {
      console.error('Seed failed:', error)
      process.exitCode = 1
    })
    .finally(() => closeDb())
}
