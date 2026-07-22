.DEFAULT_GOAL := help
.PHONY: help dev stop ps urls up down reset status install backend frontend inngest test test-fe test-be e2e e2e-install check-fe

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# --- Full stack (one command: Supabase + backend + frontend + Inngest in tmux) ---
dev: ## ⭐ Spin up the ENTIRE stack in one attachable tmux session
	./scripts/dev.sh dev

stop: ## Stop the full dev stack (tmux processes + Supabase)
	./scripts/dev.sh stop

ps: ## Show status of all dev services
	./scripts/dev.sh status

urls: ## Print all local service URLs
	./scripts/dev.sh urls

# --- Supabase (requires Docker running) ---
up: ## Start the local Supabase stack  (alias for `supabase start`)
	supabase start

down: ## Stop the local Supabase stack
	supabase stop

reset: ## Reset the local DB: re-run migrations + seed
	supabase db reset

status: ## Show local Supabase URLs and keys
	supabase status

# --- App ---
install: ## Install backend + frontend deps
	cd backend && uv sync
	cd frontend && pnpm install

backend: ## Run the FastAPI backend on :8000
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend: ## Run the Next.js frontend on :3000
	cd frontend && pnpm dev

inngest: ## Run the Inngest Dev Server on :8288 (also serves the MCP endpoint)
	npx inngest-cli@latest dev -l warn -u http://localhost:8000/api/inngest

# --- Tests ---
test: test-be test-fe ## Run backend + frontend unit tests

test-fe: ## Run frontend unit tests (Vitest, one-shot)
	cd frontend && pnpm test:run

test-be: ## Run backend tests (ruff + pytest)
	cd backend && uv run ruff check . && uv run pytest

check-fe: ## Typecheck + lint + unit test the frontend
	cd frontend && pnpm exec tsc --noEmit && pnpm lint && pnpm test:run

e2e-install: ## Install the Playwright browser (chromium) — run once
	cd frontend && pnpm e2e:install

e2e: ## Run Playwright E2E (needs the stack up via `make dev` + E2E_EMAIL/E2E_PASSWORD)
	cd frontend && pnpm e2e
