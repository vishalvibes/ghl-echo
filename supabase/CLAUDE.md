# supabase/CLAUDE.md

Database/Supabase-specific guidance. Root `../CLAUDE.md` (repo layout, commands, env/secrets, refactoring rules) still applies.

Generic database rules (lifecycle soft-delete, single state column, labels-vs-`tags` array, no bi-directional refs, junction tables for M×N, query batching to dodge `414`, back-port edit-migrations into the original migration): see `../specs/database.md`.

Local Postgres stack (config, migrations, seed) driven by the Supabase CLI.

## Commands

- `make up` / `make down` (from repo root) — start/stop local Supabase (**needs Docker running**). `make up` == `supabase start`.
- `make status` — print local Supabase URLs + keys.
- `make reset` — re-run migrations + seed.

## Conventions

- Migrations are timestamped SQL in `supabase/migrations/` (create via `supabase migration new <name>`). If you change an existing table, also back-port the change into that table's original migration.
- Tables enable RLS. The backend uses the secret key (full access, bypasses RLS); add policies before exposing a table to the browser directly.
- Prefer a single state/lifecycle column over many booleans; keep `created_at`/`updated_at`.
- Google OAuth: `[auth.external.google]` in `config.toml` reads `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET` from the env — put them in `supabase/.env` (gitignored) and load before `make up`. `skip_nonce_check = true` is required for local Google sign-in.
