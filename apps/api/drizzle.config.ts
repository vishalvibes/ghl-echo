import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  // Migrations land in the Supabase folder so `supabase db reset` replays them
  // together with the rest of the local stack — one source of truth for schema.
  out: '../../supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  },
  casing: 'snake_case',
  // Supabase-style timestamped filenames so `supabase db reset` replays them.
  migrations: { prefix: 'supabase' },
  verbose: true,
  strict: true,
})
