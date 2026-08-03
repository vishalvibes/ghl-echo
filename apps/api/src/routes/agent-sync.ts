import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { agents, scorecards, type LocationRow } from '../db/schema.js'
import { fetchVoiceAgents } from '../ghl/client.js'

/**
 * Mirror the location's Voice AI agents into our `agents` table and snapshot
 * their prompts. New agents get no scorecard — criteria are a user decision
 * (or an LLM suggestion the user approves), never invented silently.
 */
export async function syncAgentsForLocation(location: LocationRow): Promise<{ synced: number }> {
  const remote = await fetchVoiceAgents(location)
  let synced = 0
  for (const item of remote) {
    const existing = await db.query.agents.findFirst({
      where: and(eq(agents.locationId, location.id), eq(agents.ghlAgentId, item.id)),
    })
    if (existing) {
      await db
        .update(agents)
        .set({
          name: item.name,
          ...(item.prompt ? { promptSnapshot: item.prompt, promptSyncedAt: new Date() } : {}),
        })
        .where(eq(agents.id, existing.id))
    } else {
      await db.insert(agents).values({
        locationId: location.id,
        ghlAgentId: item.id,
        name: item.name,
        promptSnapshot: item.prompt ?? null,
        promptSyncedAt: item.prompt ? new Date() : null,
      })
    }
    synced++
  }
  return { synced }
}

export async function hasActiveScorecard(agentId: string): Promise<boolean> {
  const row = await db.query.scorecards.findFirst({
    where: and(eq(scorecards.agentId, agentId), eq(scorecards.isActive, true)),
    columns: { id: true },
  })
  return row !== undefined
}
