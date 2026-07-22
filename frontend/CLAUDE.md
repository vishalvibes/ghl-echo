@AGENTS.md

Generic frontend rules (no dev server, no unprompted builds, no fonts below `text-xs`): see `../specs/frontend.md`.

Generic code-organization rules (top-down, factories, reuse-first, senior-dev modular code): see `../specs/architecture.md`.

Root `../CLAUDE.md` (repo layout, commands, env/secrets, refactoring rules) still applies.

Next.js (App Router) + Tailwind v4 + shadcn/ui (Radix base) + React Query.

## Commands

- `make frontend` (from repo root) — Next.js on :3000 (`pnpm dev`).
- Checks: `cd frontend && pnpm exec tsc --noEmit && pnpm lint`.

## Conventions

- shadcn components in `src/components/ui`; `cn()` in `src/lib/utils.ts`; alias `@/* → ./src/*`.
- **Reuse before create — no duplicate components.** Before adding any component, check `src/components` and `src/components/ui` for an existing one. If it exists, **edit that file** — do not create a second copy. Need a button and a `button` already exists? Edit it. Only create a new component when it is a genuinely new **variant** of the existing one (e.g. a distinct button variant), not a re-implementation of the same thing.
- React Query: client made in `src/lib/query-client.ts`, mounted via `src/components/providers.tsx` (a `"use client"` component using `useState(makeQueryClient)`).
- Query/mutation hooks: one per file, foldered by HTTP verb.
  - Queries under `src/hooks/queries/get/` — `useXxxQuery`, array `queryKey`, module-scope fetch fn.
  - Mutations under `src/hooks/mutations/<verb>/` where `<verb>` is `post` | `put` | `patch` | `delete` (create=POST → `post/`, update=PATCH → `patch/`, delete=DELETE → `delete/`). `useXxxMutation`, invalidate the relevant `queryKey` on success.
  - Fetches use `apiFetch` from `src/lib/api.ts`.
- Auth is **client-only** Supabase (no `@supabase/ssr`/cookies): browser client singleton in `src/lib/supabase.ts`, session state + email/password sign-in/sign-up + Google OAuth via `src/components/auth-provider.tsx` (`useAuth`), mounted in `providers.tsx`. `apiFetch` attaches the access token as `Authorization: Bearer`. Google returns to the client callback page `src/app/auth/callback/page.tsx`.
- Routing: `/` is the auth gate — signed out renders `src/components/auth/login-form.tsx`, signed in redirects to `/chat`. Every authenticated screen lives in the `src/app/(app)/` route group, whose `layout.tsx` re-checks the session and wraps children in `src/components/app-shell.tsx`. **Add a new screen by creating `src/app/(app)/<name>/page.tsx` and one line in the `NAV` array in `app-shell.tsx`.**
- Demo surfaces (keep them thin — the panel components hold the logic): `/chat` (SSE streaming via `src/lib/chat-stream.ts`), `/inference` (one-shot `POST /inference`), `/todos` (CRUD), `/health` (health matrix).
- Streaming responses bypass `apiFetch` (it buffers the body) — use `streamChat` in `src/lib/chat-stream.ts`, which does raw `fetch` with the same `Authorization` header and parses the SSE event contract.
