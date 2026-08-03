# apps/web/CLAUDE.md

Vue 3 dashboard (the GHL iframe payload). Root `../../CLAUDE.md` applies.

## Layout

- `src/pages/*` — one file per route (`router.ts`). Pages compose cards; no data fetching outside composables.
- `src/composables/queries.ts` — all TanStack Query hooks. Query keys embed every parameter; mutations invalidate by prefix.
- `src/lib/api.ts` — the only fetch wrapper. Cookie-credentialed; on 401 it tries `/auth/dev-session` once (dev fallback), else surfaces `ApiError`.
- `src/components/ui/*` — small hand-rolled primitives (Card, StatTile, VerdictBadge, WindowSelect, EmptyState, LoadingBlock).
- `src/components/charts/*` — inline-SVG charts (TrendChart, BarList, Sparkline, MeterBar). No chart library.

## Conventions

- `<script setup lang="ts">` everywhere; props typed via `defineProps<{...}>`.
- Types come from `@copilot/shared` — never redeclare API shapes.
- Tailwind v4 tokens are defined in `src/style.css` (`@theme`): surfaces/ink/hairline for chrome, `series` (blue) for data, status colors (`good`/`warning`/`serious`/`critical`) reserved for state and always paired with a text label — color never carries meaning alone.
- Dev server proxies `/api`, `/auth`, `/health` to :8000 (`vite.config.ts`) — the app is same-origin; no CORS or base-URL env needed in dev.
- Verdict/severity rendering goes through `VerdictBadge` / the shared label maps (`FINDING_TYPE_LABELS`, `SEGMENT_ACTION_LABELS`); don't inline new copies.
