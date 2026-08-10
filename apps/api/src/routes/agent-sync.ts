import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { agents, type LocationRow } from '../db/schema.js'
import { fetchVoiceAgents } from '../clients/highlevel.js'
import { defaultAgentPrompt } from '../lib/default-prompt.js'

/**
 * Mirror the location's Voice AI agents into our `agents` table and snapshot
 * their prompts. New agents get the default testing prompt seeded; criteria
 * are a user decision (or an LLM suggestion the user approves), never invented
 * silently.
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
        prompt: defaultAgentPrompt(),
        promptSnapshot: item.prompt ?? null,
        promptSyncedAt: item.prompt ? new Date() : null,
      })
    }
    synced++
  }
  return { synced }
}
