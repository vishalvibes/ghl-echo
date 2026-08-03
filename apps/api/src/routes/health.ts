import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { count, eq } from 'drizzle-orm'
import { env, llmEnabled } from '../config/env.js'
import { db, pingDb } from '../db/client.js'
import { calls } from '../db/schema.js'

type ComponentState = 'ok' | 'degraded' | 'down' | 'disabled'

/**
 * Health matrix for the settings page and for anyone deploying this. Each row
 * is independently checkable; the matrix never throws.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health', async () => ({ status: 'ok' }))

  app.get('/health/matrix', async () => {
    const [dbOk, pendingRow] = await Promise.all([
      pingDb(),
      pingDb().then((ok) =>
        ok
          ? db.select({ n: count() }).from(calls).where(eq(calls.ingestStatus, 'pending'))
          : Promise.resolve([{ n: -1 }]),
      ),
    ])
    const pending = pendingRow[0]?.n ?? -1

    let inngestState: ComponentState = 'disabled'
    if (env.INNGEST_DEV === '1') {
      try {
        const response = await fetch(`${env.INNGEST_BASE_URL}/health`, {
          signal: AbortSignal.timeout(2000),
        })
        inngestState = response.ok ? 'ok' : 'degraded'
      } catch {
        inngestState = 'down'
      }
    } else {
      inngestState = env.INNGEST_EVENT_KEY ? 'ok' : 'disabled'
    }

    const components: Record<string, { state: ComponentState; detail?: string }> = {
      api: { state: 'ok' },
      database: { state: dbOk ? 'ok' : 'down' },
      queue: {
        state: inngestState,
        ...(pending > 0 ? { detail: `${pending} calls awaiting evaluation` } : {}),
      },
      llm: {
        state: llmEnabled ? 'ok' : 'disabled',
        detail: llmEnabled ? env.OPENAI_MODEL : 'OPENAI_ENABLED=false — evaluations paused',
      },
      ghl: {
        state: env.GHL_CLIENT_ID ? 'ok' : 'disabled',
        detail: env.GHL_CLIENT_ID ? undefined : 'no marketplace credentials — fixture mode',
      },
    }

    const states = Object.values(components).map((c) => c.state)
    return {
      status: states.includes('down') ? 'down' : states.includes('degraded') ? 'degraded' : 'ok',
      fixtureMode: env.USE_FIXTURES,
      components,
    }
  })
}
