import { eq } from 'drizzle-orm'
import { db } from './client.js'
import { calls, agents } from './schema.js'
import { assessCallQuality } from '../scoring/quality.js'

const id = process.argv[2]!
const call = (await db.query.calls.findFirst({ where: eq(calls.id, id) }))!
const agent = (await db.query.agents.findFirst({ where: eq(agents.id, call.agentId) }))!
try {
  const r = await assessCallQuality({ transcript: call.transcript, agentScript: agent.promptSnapshot, agentName: agent.name })
  console.log('OK', JSON.stringify(r.data).slice(0, 300))
} catch (e) {
  const err = e as Error & { raw?: string }
  console.log('FAIL:', err.message)
  console.log('RAW:', (err.raw ?? '(none)').slice(0, 1500))
}
process.exit(0)
