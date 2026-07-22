# Frontend

Generic frontend working rules. Stack-specific conventions live in `frontend/CLAUDE.md`.

## Dev server

- Never start a dev server (`pnpm dev` / `pnpm run dev`). Assume one is already running.

## Builds

- Don't run builds to check or verify things. Build only when explicitly asked.

## Styling

- No font sizes smaller than `text-xs` unless absolutely necessary.
