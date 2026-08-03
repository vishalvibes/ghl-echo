import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Load apps/api/.env before validating. Native loader (Node 21+) — no dotenv
// dependency. Real environment variables win over file values.
const envFile = join(dirname(fileURLToPath(import.meta.url)), '../../.env')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

/**
 * Fail fast and loudly on bad configuration. A half-configured observability
 * tool is worse than one that refuses to boot: it silently stops evaluating.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.url().default('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),

  /** Comma-separated. Must include the GHL iframe origin in production. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  /** Signs the iframe session cookie. Required outside development. */
  SESSION_SECRET: z.string().min(32).default('dev-only-session-secret-change-me-please'),

  /** AES-256-GCM key (32 bytes, hex) for OAuth tokens at rest. */
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'must be 64 hex chars (32 bytes)')
    .default('0'.repeat(64)),

  /**
   * Standalone-login credentials (outside the GHL iframe). Maps to the demo
   * location. Bar for a template login, not a user system.
   */
  DEMO_LOGIN_EMAIL: z.string().default('demo@copilot.dev'),
  DEMO_LOGIN_PASSWORD: z.string().default('copilot123'),

  // --- HighLevel ---
  GHL_CLIENT_ID: z.string().default(''),
  GHL_CLIENT_SECRET: z.string().default(''),
  GHL_REDIRECT_URI: z.string().default('http://localhost:8000/auth/oauth/callback'),
  GHL_API_BASE: z.url().default('https://services.leadconnectorhq.com'),
  GHL_API_VERSION: z.string().default('2021-07-28'),
  /** Shared secret used to verify inbound webhook signatures. */
  /**
   * Verify inbound webhook signatures against HighLevel's public keys. Off by
   * default for local replay/curl testing, which cannot produce a valid
   * signature; production boot should set this to true.
   */
  GHL_VERIFY_WEBHOOKS: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** App's Shared Secret (Manage > Secrets) — decrypts Custom Page SSO postMessage payloads. */
  GHL_SSO_KEY: z.string().default(''),

  // --- LLM ---
  OPENAI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-5.6-terra'),
  OPENAI_BASE_URL: z.string().optional(),

  // --- Inngest ---
  INNGEST_DEV: z.enum(['0', '1']).default('1'),
  INNGEST_BASE_URL: z.url().default('http://localhost:8288'),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),

  /**
   * Serve fixture transcripts instead of calling the GHL API. Lets the whole
   * product be demoed before the marketplace app is approved.
   */
  USE_FIXTURES: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})

export type Env = z.infer<typeof envSchema>

function load(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  const env = parsed.data
  if (env.NODE_ENV === 'production') {
    const insecure: string[] = []
    if (env.SESSION_SECRET.startsWith('dev-only')) insecure.push('SESSION_SECRET')
    if (/^0+$/.test(env.TOKEN_ENCRYPTION_KEY)) insecure.push('TOKEN_ENCRYPTION_KEY')
    if (insecure.length > 0) {
      throw new Error(`Refusing to boot in production with default secrets: ${insecure.join(', ')}`)
    }
  }
  return env
}

export const env = load()

/** True when the judge model can actually be called. */
export const llmEnabled = env.OPENAI_ENABLED && env.OPENAI_API_KEY.length > 0
