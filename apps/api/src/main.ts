import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rawBody from 'fastify-raw-body'
import inngestFastify from 'inngest/fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { env } from './config/env.js'
import { closeDb } from './db/client.js'
import { inngest } from './inngest/client.js'
import { functions } from './inngest/functions.js'
import { apiRoutes } from './routes/api.js'
import { authRoutes } from './routes/auth.js'
import { healthRoutes } from './routes/health.js'
import { webhookRoutes } from './routes/webhooks.js'

/**
 * Assembly point. Route modules own their handlers; this file only wires
 * plugins, security headers, and lifecycle.
 */
export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : {}),
    },
    // Dev tunnels (ngrok) terminate TLS in front of the Vite proxy chain —
    // trust X-Forwarded-Proto so request.protocol reflects what the browser
    // actually used, not the plain-HTTP hop between Vite and Fastify.
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(helmet, {
    // The dashboard must be embeddable in HighLevel's iframe.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    frameguard: false,
  })
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true })
  await app.register(cookie)
  // GHL signs the exact bytes it sent. Re-serializing the parsed body changes
  // key order and whitespace, so signature checks need the original buffer;
  // routes opt in with `config: { rawBody: true }`.
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true })

  await app.register(healthRoutes)
  await app.register(authRoutes)
  await app.register(webhookRoutes)
  await app.register(apiRoutes)
  await app.register(inngestFastify, { client: inngest, functions })

  return app
}

const isDirectRun = process.argv[1]?.endsWith('main.ts') ?? false
if (isDirectRun) {
  const app = await buildApp()

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    await closeDb()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}
