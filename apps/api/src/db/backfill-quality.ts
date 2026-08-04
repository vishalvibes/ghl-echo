import { eq } from 'drizzle-orm'
import { db } from './client.js'
import { calls, agents } from './schema.js'
import { assessQuality } from '../calls/quality.js'

/**
 * Re-run the quality pass over every call in the local DB.
 *
 * Only needed when the quality schema changes: stored assessments carry the
 * shape they were written with, and a row that no longer parses fails the
 * call-detail response rather than degrading quietly. `--force` clears first;
 * without it this only fills gaps.
 */
const force = process.argv.includes('--force')
if (force) {
  await db.update(calls).set({ quality: null })
}

const rows = await db.query.calls.findMany()
let assessed = 0
let failed = 0
for (const call of rows) {
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, call.agentId) })
  if (!agent) continue
  try {
    const result = await assessQuality(call, agent)
    if (result.assessed) assessed++
  } catch (error) {
    failed++
    console.error(`${call.id}: ${(error as Error).message}`)
  }
}
console.log(`quality backfill: ${assessed} assessed, ${failed} failed, ${rows.length} total`)
process.exit(failed > 0 ? 1 : 0)
