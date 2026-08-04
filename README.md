# Voice AI Observability Copilot

An **Agent Observability Copilot** for HighLevel Voice AI agents. It automates
the *Monitor* and *Analyze* phases: ingest call transcripts, judge every call
with an LLM, optionally apply additional per-agent scorecard criteria, and turn
evidence-backed failures into ranked prompt fixes.

```
GHL call ends ──webhook──▶ API ──queue──▶ LLM judge ──▶ scores / findings / actions
                                                              │
        HighLevel iframe ◀── Vue dashboard ◀── aggregations ──┘
```

| Part | Stack | Dir |
|------|-------|-----|
| API + workers | Node 22, Fastify 5, Drizzle, Inngest, zod | `apps/api/` |
| Dashboard | Vue 3, Vite, Tailwind v4, TanStack Query | `apps/web/` |
| Shared contracts | zod schemas (scorecards, judge output, API) | `packages/shared/` |
| Database | Postgres via the local Supabase CLI stack | `supabase/` |

## Prerequisites

- [Docker](https://www.docker.com/) **running** (local Postgres)
- Node 22+, `pnpm`, and the `supabase` CLI on your PATH
- tmux (for `make dev`; auto-installed via brew if missing)

## Quick start

```bash
make install        # pnpm install at repo root (never inside apps/*)
cp apps/api/.env.example apps/api/.env    # defaults work for fixture mode
make dev            # Supabase + API + dashboard + Inngest in one tmux session
```

`make install` is the only install entrypoint. App-level `node_modules/` folders
are pnpm symlink stubs into the shared root store — not duplicate installs.
Use `make reinstall` for a clean wipe + reinstall.

`make dev` seeds a **demo location** — three reference agents with handcrafted
calls and evaluations — so the full dashboard works with **no HighLevel account
and no OpenAI key**. Open http://localhost:5173 and sign in with:

- email: `demo@copilot.dev`
- password: `copilot123`

(Configurable via `DEMO_LOGIN_EMAIL` / `DEMO_LOGIN_PASSWORD` in `apps/api/.env`.
Inside the HighLevel iframe the login screen is skipped — the GHL context
exchange signs the user in automatically.)

To evaluate calls with the real judge, set in `apps/api/.env`:

```bash
OPENAI_ENABLED=true
OPENAI_API_KEY=sk-...
```

## What's functional vs mocked

| Piece | Status |
|---|---|
| Transcript normalization, judging, scoring, storage | functional |
| Always-on call quality monitoring | functional; custom criteria are optional |
| Dashboard (overview, agent detail, calls, call evidence, actions, scorecards) | functional |
| LLM judge + recommendations + criteria generation | functional (needs OpenAI key) |
| GHL OAuth install flow, webhook ingest, backfill | implemented, needs marketplace app credentials |
| Demo call data | mocked (seeded fixtures, flagged `is_mock`) |
| Prompt patch write-back to GHL | mocked (copy-to-clipboard by design) |

## Commands

| Command | What |
|---|---|
| `make dev` / `make stop` | full stack up/down (tmux) |
| `make reset` | re-run migrations + reseed demo data |
| `make seed` | reseed demo data only (idempotent) |
| `make check` | typecheck + unit tests, all packages |
| `make migrate` | generate a migration from `apps/api/src/db/schema.ts` |

## HighLevel installation

1. Create a marketplace app (sub-account distribution) with scopes
   `conversations.readonly`, `locations.readonly`, and the Voice AI read scopes.
2. Set the OAuth redirect to `<your-host>/auth/oauth/callback` and put the client
   id/secret in `apps/api/.env`.
3. Add a **Custom Page / Custom Menu Link** pointing at the deployed `apps/web`
   origin — the dashboard exchanges the iframe context for a session and scopes
   every read to that location.
4. Point the app's call-completed webhook at `<your-host>/webhooks/ghl`.
   Install triggers an API backfill of available call logs. New calls arrive
   through webhooks.

## EC2 deployment

The production host runs four isolated services: PostgreSQL, the Fastify API,
the self-hosted Inngest server, and Nginx serving the Vue build. Templates live
in `deploy/ec2/`; application secrets stay in the ignored `apps/api/.env`.

After pulling a release on the host:

```bash
pnpm install --frozen-lockfile
pnpm --filter @copilot/web build
set -a; source apps/api/.env; set +a
./scripts/migrate-production.sh
sudo systemctl restart echo-inngest echo-api nginx
```
