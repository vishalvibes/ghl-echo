import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../config/env.js'
import * as schema from './schema.js'

/**
 * One pooled connection per process. `max: 10` keeps room under the local
 * Supabase Postgres default of 100 when the API and the worker both run.
 */
const client = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === 'test' ? 1 : 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
})

export const db = drizzle(client, { schema })
export type Db = typeof db

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 })
}

export async function pingDb(): Promise<boolean> {
  try {
    await client`select 1`
    return true
  } catch {
    return false
  }
}
