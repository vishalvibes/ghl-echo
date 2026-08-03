# supabase/CLAUDE.md

Database guidance. Root `../CLAUDE.md` (repo layout, commands, env/secrets, refactoring rules) still applies.

Generic database rules (lifecycle soft-delete, single state column, labels-vs-`tags` array, no bi-directional refs, junction tables for M×N, query batching to dodge `414`, back-port edit-migrations into the original migration): see `../specs/database.md`.

Local **plain Postgres** stack driven by the Supabase CLI. Supabase Auth, RLS,
and Storage are **unused** — the API is the only client (via `DATABASE_URL`)
and owns all access control through the iframe session.

## Commands

- `make up` / `make down` (repo root) — start/stop local Supabase (**needs Docker running**).
- `make status` — print local URLs.
- `make reset` — re-run migrations + reseed demo data (`pnpm --filter @copilot/api seed`).
- `make migrate` — **the only way to create migrations**: drizzle-kit diffs `apps/api/src/db/schema.ts` and writes a timestamped SQL file here (plus `migrations/meta/` journal — commit both).

## Conventions

- Schema source of truth is TypeScript (`apps/api/src/db/schema.ts`). Do not hand-write or hand-edit SQL in `supabase/migrations/` — change the TS schema and regenerate.
- `seed.sql` is intentionally a no-op; demo data seeding lives in `apps/api/src/db/seed.ts` because it runs the real scoring pipeline.
- Every tenant-queryable table has `location_id` (GHL sub-account). Scorecards are append-only versions; `evaluations` are unique per `(call_id, scorecard_version)`.
