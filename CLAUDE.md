# CLAUDE.md

Guidance for Claude Code when working in this repo. Keep it terse.

## Keeping this file current

Whenever a change contradicts something written here (new command, moved file, changed convention, replaced tool, altered env/secret handling), flag it and recommend updating this `CLAUDE.md` so the guidance stays accurate. Do not let the doc drift out of sync with the code — surface the conflict as soon as you notice it, and propose the exact edit.

## Explaining things

When explaining a difficult concept or anything complex — data flow, architecture, auth/token flow, request lifecycle, state machines, tricky control flow — draw an **ASCII diagram** alongside the prose. Show the moving parts and how they connect, not just a wall of text.

## Refactoring rules

Applies to the entire monorepo — `apps/`, `packages/`, and `supabase/`.

Before refactoring, find existing tests that cover the behavior. If coverage is missing, propose minimal characterization tests that lock in current behavior.

Using ASCII diagrams, present:
1. Current architecture summary
2. Risky dependencies
3. Refactor plan in small commits
4. Tests that should pass before and after
5. Files likely to change
6. Proposed new architecture and folder structure

Rules:
- Do not make code changes yet.
- At each important step, stop and wait for the user's command before proceeding.
- Do not continue automatically after planning, editing, test creation, or test execution.
- Keep the output focused and structured.

## What this repo is

**Voice AI Observability Copilot** — a HighLevel (GHL) marketplace app that
monitors Voice AI agent calls. Two loops:

- **Monitor**: webhook/backfill ingests call transcripts → Inngest worker →
  LLM judge scores each call against the agent's versioned **scorecard** →
  stores evaluation + criterion results + findings + "use action" segments.
- **Analyze**: Vue dashboard (iframed into GHL) shows pass rates, failure
  modes, per-call transcript evidence, an action queue, and LLM-generated
  prompt-patch recommendations grounded in evidence call links.

Key invariants:
- The judge model never computes the overall score — `scoreCall()` in
  `packages/shared/src/score.ts` does (reproducible arithmetic).
- Scorecards are versioned append-only; evaluations pin their version.
- Judge output referencing nonexistent turn ids is sanitized before persist.
- Every table row is scoped by `location_id` (GHL sub-account = tenant).
- Demo/fixture rows are flagged `is_mock`; seeded via `make seed`.

### Models

Default judge model is **`gpt-5.6-terra`** (`OPENAI_MODEL`). The GPT-5.6 family
(released 2026-07-09) is one generation in three tiers — all 1M context, 128k
max output, 2026-02-16 knowledge cutoff:

| Model id | Tier | $/1M in | $/1M out | Use for |
|----------|------|---------|----------|---------|
| `gpt-5.6-luna` | fast/cheap | 1 | 6 | high-volume, latency-sensitive |
| `gpt-5.6-terra` | balanced (default) | 2.50 | 15 | everyday app work |
| `gpt-5.6-sol` | flagship | 5 | 30 | hard reasoning, coding, agents |

`gpt-5.6` is an alias for Sol. **Do not downgrade the default to an older
`gpt-5*` model** — pick a tier within this family instead.

Note: the OpenAI SDK reads `OPENAI_BASE_URL` from the environment on its own.
Keep it **commented out** in `.env` rather than set to an empty string — a
blank value makes every call fail. `apps/api/src/lib/llm.ts` passes `baseURL`
explicitly to neutralize this.

## Stack & layout

pnpm workspace monorepo (Node 22+, TypeScript, ESM everywhere):
- `apps/api/` — Fastify 5 + zod (`fastify-type-provider-zod`), Drizzle ORM, Inngest v4 workers, OpenAI SDK.
- `apps/web/` — Vue 3 + Vite + Tailwind v4 + TanStack Query. SPA served into the GHL iframe; dev server proxies `/api`, `/auth`, `/health` to :8000.
- `packages/shared/` — zod schemas shared api↔web (scorecard, judge output, API responses) + `scoreCall`. Single source of truth; never duplicate these types.
- `supabase/` — local Postgres stack (Supabase CLI). **Auth/RLS unused** — plain Postgres; the API owns access control via the iframe session.

## Commands

- `make dev` — **one command for everything** (`scripts/dev.sh`): Supabase + API + web + Inngest Dev Server in one tmux session, plus idempotent demo seed. `make stop` / `make ps` / `make urls`. Needs Docker + tmux.
- `make up` / `make down` — local Supabase only. `make status` — URLs/keys.
- `make reset` — migrations + demo reseed. `make seed` — reseed only.
- `make api` (:8000) / `make web` (:5173) / `make inngest` (:8288) — individual services.
- `make check` — `pnpm -r typecheck && pnpm -r test` (run before calling work done).
- `make migrate` — drizzle-kit generates a timestamped SQL migration into `supabase/migrations/` from `apps/api/src/db/schema.ts`. Schema lives in TS; never hand-write migrations.

## Auth model (no Supabase Auth)

```
GHL iframe ──postMessage context──▶ web ──POST /auth/session──▶ API
                                                │ verify location installed
                                                ▼
standalone ──/login page──▶ POST /auth/login    HttpOnly cookie
              (DEMO_LOGIN_EMAIL/PASSWORD)       (JWT, locationId-scoped)
```
- Tenant always comes from the session cookie, never from query params.
- Standalone credentials: `demo@copilot.dev` / `copilot123` (env-overridable) → session for the seeded demo location. **Always use these — no user table exists.**
- 401 in the web app hard-navigates to `/login?next=<path>`; `POST /auth/dev-session` still exists for curl/tooling (non-production only).

## Testing

- Unit tests: Vitest, colocated `*.test.ts`. `make test` or per-package `pnpm --filter @copilot/api test`.
- No e2e suite yet. The old Playwright suite and seeded Supabase test user are **gone** — do not reference `e2e-test@example.com`.
- Fixture-first development: `USE_FIXTURES=true` + LLM disabled serves the seeded demo evaluations; the whole dashboard is testable without keys.

## Local DB access

No cloud Supabase MCP. Query the **local** Postgres through the Supabase DB Docker container:

```bash
docker exec supabase_db_echo psql -U postgres -d postgres -c "select id, name from agents;"
```

- Container name follows the repo folder (`supabase_db_<dirname>`) — find it with `docker ps --filter name=supabase_db`.
- `psql` is **not** installed on the host — always go through `docker exec`.
- Direct connection string: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (also the API's `DATABASE_URL` default).
- App tables live in `public`; `auth.*` tables exist but are unused.

## Inngest MCP

The `inngest` MCP server (`.mcp.json`, `http://127.0.0.1:8288/mcp`) inspects the queue on the local Inngest Dev Server — registered functions (`evaluate-call`, `backfill-agent`, `sweep-pending-calls`), run status, events, manual triggers. Requires the Dev Server running (`make dev`).

## Git workflow

Commit and push to the **current branch** unless told otherwise — even when that branch is `main`. Do not auto-create a new branch before committing.

## Bug checking

Pick the tool by what you're reviewing:

- **Uncommitted / staged / local changes** — the `/code-review` skill (reviews the working-tree diff). `/security-review` for the security angle. Do **not** use greptile for uncommitted work — it ignores uncommitted files.
- **Committed changes on a branch** — the **greptile CLI**: `greptile review` diffs the current branch against its base. Requires an `origin` remote and the repo indexed in the Greptile dashboard. Flow: feature branch → commit → push → `greptile review`.
- **A GitHub PR** — the `/review` skill.

## Domain-specific conventions

Subtree docs (auto-load when working in that folder):
- `apps/api/CLAUDE.md` — Fastify/Drizzle/Inngest conventions.
- `apps/web/CLAUDE.md` — Vue/TanStack Query/Tailwind conventions.
- `supabase/CLAUDE.md` — migrations, local stack.

## Env / secrets

- **Two env files, by consumer** (gitignored; commit only `.env.example`):
  - **Root `.env` — MCP / tooling only** (`LINEAR_API_KEY`, etc.). Claude Code expands `${VAR}` in `.mcp.json` from the **shell env**, not this file. `LINEAR_API_KEY` lives in the macOS login Keychain; a `claude()` wrapper in `~/.zshrc` exports it before launching.
  - **`apps/api/.env` — all backend config** (`cp apps/api/.env.example apps/api/.env`). Loaded natively via `process.loadEnvFile` in `src/config/env.ts`. Includes `DATABASE_URL`, GHL OAuth creds, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, OpenAI, Inngest.
  - The web app has **no env file** — it is same-origin via the Vite proxy in dev and configured at deploy time.
- Secrets rules: OAuth tokens are AES-256-GCM encrypted at rest (`TOKEN_ENCRYPTION_KEY`); production boot refuses default secrets (`src/config/env.ts`).
