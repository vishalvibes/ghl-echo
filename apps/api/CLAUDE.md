# apps/api/CLAUDE.md

Fastify API + workers. Root `../../CLAUDE.md` (commands, env, invariants) applies.

## Layout

- `src/main.ts` — assembly point only: plugins, security headers, route registration, lifecycle. No handlers here.
- `src/config/env.ts` — zod-validated env, loaded once, fail-fast. Import `env` from here; never read `process.env` elsewhere.
- `src/db/schema.ts` — Drizzle schema = the migration source (`make migrate`). Every tenant-queryable table carries `location_id`.
- `src/routes/*` — route modules (`FastifyPluginAsyncZod`). `/api/*` routes sit behind the `requireSession` preHandler; tenant comes from `request.session.locationId`, never from params.
- `src/scoring/*` — judge prompt + `judgeCall` (LLM) + sanitization, plus `quality.ts`: one prompt, one zod schema, one JSON blob per call (`calls.quality`). The judge never returns an overall score; `scoreCall` (shared pkg) computes it.
- `src/ingest/*` — normalize (GHL shapes → `Turn[]`), evaluate (persist pipeline), ghl-ingest (the only file that knows raw GHL payload shapes).
- `src/insights/recommend.ts` — SQL clustering + LLM recommendations, cached by evidence hash. Evidence call ids are mapped server-side; the model returns cluster indexes and can never fabricate a link.
- `src/inngest/*` — Inngest v4. `createFunction({ id, triggers: [...] }, handler)`; `step.run` return values are JSON-serialized (Dates become strings) — pass ids across step boundaries, reload rows inside.
- `src/fixtures/*` — demo agents/calls with hand-written judge outputs; seeded by `src/db/seed.ts` (idempotent).

## Conventions

- ESM + `.js` import suffixes (verbatimModuleSyntax). Types via `import type`.
- Validation at the edge with zod route schemas; shared shapes come from `@copilot/shared` — never redeclare them here.
- LLM calls only through `completeStructured` in `src/lib/llm.ts` (schema-validated, one retry). Catch `code === 'LLM_DISABLED'` → 503.
- Webhooks answer 200 fast; anything slow goes through an Inngest event.
- The quality pass (`src/ingest/quality.ts`) runs ahead of the scorecard gate and is non-fatal — it is the only read a call gets when the agent has no scorecard. Changing `callQualitySchema` invalidates stored rows: re-run `pnpm --filter @copilot/api backfill:quality -- --force`.
- Idempotency by unique index (`calls (location_id, ghl_call_id)`, `evaluations (call_id, scorecard_version)`), not by application checks alone.
- Tests: Vitest colocated `*.test.ts`, pure-function focus (normalize, sanitize, score). No DB in unit tests.
