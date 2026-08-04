import { eq, inArray } from 'drizzle-orm'
import { db } from './client.js'
import { calls, agents } from './schema.js'
import { assessQuality } from '../calls/quality.js'

const rows = await db.query.calls.findMany({ where: inArray(calls.isMock, [false, true]) })
for (const call of rows) {
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, call.agentId) })
  if (!agent) continue
  try {
    const r = await assessQuality(call, agent)
    console.log(call.id, JSON.stringify(r))
  } catch (e) {
    console.log(call.id, 'ERROR', (e as Error).message)
  }
}
process.exit(0)
