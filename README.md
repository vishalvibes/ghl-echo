# template

FastAPI + Next.js + Supabase starter (monorepo).

| Part | Stack | Dir |
|------|-------|-----|
| Backend | FastAPI, [uv](https://docs.astral.sh/uv/), Python 3.12 | `backend/` |
| Frontend | Next.js (App Router), Tailwind v4, shadcn/ui, React Query | `frontend/` |
| Database | Supabase (local Postgres via the Supabase CLI) | `supabase/` |

## Prerequisites

- [Docker](https://www.docker.com/) **running** (required for the local Supabase stack)
- `uv`, `pnpm`, and the `supabase` CLI on your PATH

## Quick start

```bash
# 1. Install dependencies
make install                 # uv sync (backend) + pnpm install (frontend)

# 2. Start the database  (Docker must be running)
make up                      # == supabase start
make status                  # copy the anon + service_role keys it prints

# 3. Configure env
cp backend/.env.example backend/.env         # paste SUPABASE_ANON_KEY + SERVICE_ROLE_KEY
cp frontend/.env.example frontend/.env.local

# 4. Run (two terminals)
make backend                 # FastAPI  -> http://localhost:8000  (docs at /docs)
make frontend                # Next.js  -> http://localhost:3000
```

Or, in one shot: `make dev` (Supabase + backend + frontend + Inngest in one tmux
session).

## What's in the template

`/` is the auth gate — Supabase email + password (Google OAuth optional). Sign in
with the seeded user (`e2e-test@example.com` / `testpass123`) and you land in the
app shell, which has one route per reference surface:

| Route | Shows | Backend |
|-------|-------|---------|
| `/chat` | Streaming multi-turn chat (SSE, token-by-token) | `POST /chat/stream` |
| `/inference` | One-shot prompt → completion | `POST /inference` |
| `/todos` | CRUD via React Query, scoped to the signed-in user | `/todos` |
| `/health` | Health matrix: frontend + API + Supabase + LLM + Inngest | `GET /health/matrix` |

Chat and inference need OpenAI configured (`OPENAI_ENABLED=true` + `OPENAI_API_KEY`
in `backend/.env`); without it they return 503 and the health matrix shows the
`llm` row as `disabled`. Everything else works out of the box. Set
`OPENAI_BASE_URL` to use any OpenAI-compatible gateway instead.

Default model is `gpt-5.6-terra`, the balanced tier of the GPT-5.6 family — swap
`OPENAI_MODEL` for `gpt-5.6-luna` (cheapest/fastest) or `gpt-5.6-sol` (flagship).

## Common commands

| Command | What |
|---------|------|
| `make up` / `make down` | Start / stop local Supabase |
| `make status` | Print local Supabase URLs + keys |
| `make reset` | Re-run migrations + reseed the DB |
| `make backend` | Run FastAPI (`:8000`) |
| `make frontend` | Run Next.js (`:3000`) |

> Note: `supabase up` is not a real CLI command — the Supabase CLI uses
> `supabase start`. `make up` is provided as the `up` alias you wanted.

## Database changes

```bash
supabase migration new <name>   # create a timestamped migration in supabase/migrations/
# edit the generated .sql, then:
make reset                      # apply migrations + seed to the local DB
```

See `CLAUDE.md` for backend/frontend/database conventions.
