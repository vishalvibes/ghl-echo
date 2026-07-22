# API Design

Generic REST conventions. Stack-specific routing lives in `CLAUDE.md`.

## GET collections (`GET /{entity}s`)

- Filter with query params — no filter sub-routes.
- Required filters: `start_time`, `end_time` (Zulu format), `limit`, `cursor`.
- Max `limit`: 1000.

## Updates (`PATCH /{entity}s/{id}`)

- One PATCH route per entity for partial updates. No field-specific update routes.
