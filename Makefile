.DEFAULT_GOAL := help
.PHONY: help dev stop ps urls up down reset status install reinstall api web inngest seed test test-api test-web test-shared check migrate

# Always operate from the repo root — never `pnpm install` inside apps/* or packages/*.
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# --- Full stack (one command: Supabase + API + web + Inngest in tmux) ---
dev: ## ⭐ Spin up the ENTIRE stack in one attachable tmux session
	./scripts/dev.sh dev

stop: ## Stop the full dev stack (tmux processes + Supabase)
	./scripts/dev.sh stop

ps: ## Show status of all dev services
	./scripts/dev.sh status

urls: ## Print all local service URLs
	./scripts/dev.sh urls

# --- Supabase / Postgres (requires Docker running) ---
up: ## Start the local Supabase stack  (alias for `supabase start`)
	supabase start

down: ## Stop the local Supabase stack
	supabase stop

reset: ## Reset the local DB: re-run migrations + reseed demo data
	supabase db reset
	pnpm --filter @copilot/api seed

status: ## Show local Supabase URLs and keys
	supabase status

migrate: ## Generate a new migration from apps/api/src/db/schema.ts changes
	pnpm --filter @copilot/api db:generate

seed: ## Seed demo agents, calls and evaluations (idempotent)
	pnpm --filter @copilot/api seed

# --- App ---
# pnpm workspace: one install at the repo root. apps/*/node_modules and
# packages/*/node_modules are symlink stubs into the shared store — expected,
# not duplicate installs. Never run pnpm/npm install inside those folders.
install: ## Install all workspace deps (from repo root only)
	cd $(ROOT) && pnpm install

reinstall: ## Wipe every node_modules then reinstall from root
	cd $(ROOT) && rm -rf node_modules apps/*/node_modules packages/*/node_modules
	cd $(ROOT) && pnpm install

api: ## Run the Fastify API on :8000
	cd $(ROOT) && pnpm --filter @copilot/api dev

web: ## Run the Vue dashboard on :5173
	cd $(ROOT) && pnpm --filter @copilot/web dev

inngest: ## Run the Inngest Dev Server on :8288 (also serves the MCP endpoint)
	cd $(ROOT) && npx inngest-cli@latest dev -l warn -u http://localhost:8000/api/inngest

# --- Tests / checks ---
test: ## Run all workspace unit tests
	pnpm -r test

test-api: ## API tests only
	pnpm --filter @copilot/api test

test-web: ## Web tests only
	pnpm --filter @copilot/web test

test-shared: ## Shared package tests only
	pnpm --filter @copilot/shared test

check: ## Typecheck + test everything
	pnpm -r typecheck && pnpm -r test
