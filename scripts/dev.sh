#!/usr/bin/env bash
#
# voice-ai-copilot dev orchestrator — one command to spin up the whole local stack.
#
# Brings up infra (Docker + Supabase Postgres + Inngest) then launches every
# long-running process in a single attachable tmux session.
#
#   scripts/dev.sh [command]
#
# Commands:
#   dev      Start the full stack in tmux and attach (default; reattaches if up)
#   stop     Stop tmux processes + Supabase
#   status   Show what's running
#   urls     Print all local service URLs
#   open     Open a service in the browser:  open [api|web|inngest|studio]
#   logs     Tail a pane's logs:             logs [api|web|inngest]
#
set -euo pipefail

# --- Paths -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SESSION="copilot"
PORT_FILE="/tmp/copilot.web.port"   # actual web port, written at startup

# --- Colors / print helpers --------------------------------------------------
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'; MAGENTA=$'\033[0;35m'; CYAN=$'\033[0;36m'
WHITE=$'\033[1;37m'; BOLD=$'\033[1m'; NC=$'\033[0m'

info()    { echo -e "${BLUE}ℹ️  $1${NC}"; }
step()    { echo -e "${CYAN}🔹 $1${NC}"; }
success() { echo -e "${GREEN}✅ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()     { echo -e "${RED}❌ $1${NC}" 1>&2; }
die()     { err "$1"; exit 1; }
header()  { echo -e "\n${MAGENTA}${BOLD}━━━ $1 ━━━${NC}\n"; }

# --- Ports -------------------------------------------------------------------
# First free TCP port at/above $1 (Vite auto-increments from 5173 otherwise,
# so we pin it explicitly and report the real value everywhere).
free_port() { local p="${1:-5173}"; while lsof -i ":$p" -sTCP:LISTEN >/dev/null 2>&1; do p=$((p + 1)); done; echo "$p"; }
# The web port chosen for the current session (defaults to 5173 if unknown).
web_port() { [ -f "$PORT_FILE" ] && cat "$PORT_FILE" 2>/dev/null || echo 5173; }

# --- Preflight ---------------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1; }

check_deps() {
  header "🔍 Checking dependencies"
  need node     || die "node not found — install Node.js 22+"
  need pnpm     || die "pnpm not found — https://pnpm.io/installation"
  need supabase || die "supabase CLI not found — brew install supabase/tap/supabase"
  need docker   || die "docker not found — install Docker Desktop"
  need npx      || die "npx not found — install Node.js"
  if ! need tmux; then
    if need brew; then
      warn "tmux not found — installing via brew..."
      brew install tmux >/dev/null 2>&1 || die "Failed to install tmux"
    else
      die "tmux not found — brew install tmux"
    fi
  fi
  success "All dependencies present"

  [ -f "$REPO_ROOT/apps/api/.env" ] || \
    warn "apps/api/.env is missing — run 'cp apps/api/.env.example apps/api/.env' (defaults work for fixture mode)"
}

start_docker() {
  if docker info >/dev/null 2>&1; then
    success "Docker is running"
    return
  fi
  step "Launching Docker Desktop..."
  open --background -a Docker || die "Failed to start Docker"
  while ! docker info >/dev/null 2>&1; do
    printf "\r${CYAN}⏳ Waiting for Docker...${NC}"; sleep 2
  done
  printf "\r${GREEN}✅ Docker is running          ${NC}\n"
}

start_supabase() {
  cd "$REPO_ROOT"
  if supabase status >/dev/null 2>&1; then
    info "Supabase already running"
  else
    step "Starting Supabase..."
    supabase start >/dev/null 2>&1 || die "Failed to start Supabase"
    success "Supabase started"
  fi
}

seed_demo() {
  step "Seeding demo data (idempotent)..."
  ( cd "$REPO_ROOT" && pnpm --filter @copilot/api seed >/dev/null 2>&1 ) \
    && success "Demo data ready" \
    || warn "Seed failed — run 'make seed' manually to see the error"
}

# --- Dashboard pane ----------------------------------------------------------
dashboard_script() {
  local path="/tmp/copilot_dashboard.sh"
  cat > "$path" <<DASH
#!/usr/bin/env bash
clear
echo -e "${MAGENTA}${BOLD}  voice-ai-copilot — local dev${NC}\n"
echo -e "${CYAN}${BOLD}URLs:${NC}"
echo -e "  ${WHITE}API${NC}         http://localhost:8000  (health: /health/matrix)"
echo -e "  ${WHITE}Dashboard${NC}   http://localhost:$WEB_PORT"
echo -e "  ${WHITE}Inngest${NC}     http://localhost:8288"
echo -e "  ${WHITE}Supabase${NC}    http://localhost:54323  (Studio)"
echo ""
echo -e "${CYAN}${BOLD}Commands:${NC}"
echo -e "  ${WHITE}make stop${NC} · ${WHITE}make ps${NC} · ${WHITE}make urls${NC} · ${WHITE}make seed${NC}"
echo ""
echo -e "${CYAN}${BOLD}tmux:${NC} Ctrl+B then ↑↓←→ move · d detach · z zoom · [ scroll"
echo -e "${GREEN}${BOLD}✨ All services running.${NC}\n"
cd "$REPO_ROOT" || cd ~
exec bash
DASH
  chmod +x "$path"
  echo "$path"
}

# --- Main: dev ---------------------------------------------------------------
cmd_dev() {
  header "🚀 Starting voice-ai-copilot dev environment"
  check_deps
  start_docker
  start_supabase
  seed_demo

  if tmux has-session -t "$SESSION" 2>/dev/null; then
    info "Session already running — reattaching..."
    exec tmux attach -t "$SESSION"
  fi

  # Pin the web app to the first free port (avoids the silent 5173→5174 hop
  # when another project already holds 5173) and record it for status/urls.
  WEB_PORT="$(free_port 5173)"
  echo "$WEB_PORT" > "$PORT_FILE"
  [ "$WEB_PORT" = "5173" ] || info "Port 5173 busy — dashboard will use :$WEB_PORT"

  local dash; dash="$(dashboard_script)"
  step "Creating tmux session ($SESSION)..."

  # Pane 0: API (Fastify + Inngest serve at /api/inngest)
  tmux new-session -d -s "$SESSION" -n main -c "$REPO_ROOT/apps/api" \
    "pnpm dev"
  # Pane 1: web (Vite) — --port pins the dev server deterministically
  tmux split-window -h -t "$SESSION" -c "$REPO_ROOT/apps/web" "pnpm dev --port $WEB_PORT --strictPort"
  # Pane 2: Inngest Dev Server (also serves the MCP endpoint on :8288)
  tmux select-pane -t 0
  tmux split-window -v -t "$SESSION" -c "$REPO_ROOT" \
    "npx inngest-cli@latest dev -l warn -u http://localhost:8000/api/inngest"
  # Pane 3: dashboard
  tmux select-pane -t 2
  tmux split-window -v -t "$SESSION" "bash $dash"
  tmux select-layout -t "$SESSION" tiled

  tmux select-pane -t "$SESSION:0.0" -T api
  tmux select-pane -t "$SESSION:0.1" -T web
  tmux select-pane -t "$SESSION:0.2" -T inngest
  tmux select-pane -t "$SESSION:0.3" -T dashboard

  tmux set-option -t "$SESSION" -g mouse on
  tmux set-option -t "$SESSION" -g mode-keys vi
  tmux set-option -t "$SESSION" -g set-clipboard on
  tmux set-option -t "$SESSION" -s copy-command pbcopy
  # Keep a crashed service's pane on screen (with its error) instead of letting
  # tmux delete it — a vanished pane is why "where's the API?" happens.
  tmux set-window-option -t "$SESSION" remain-on-exit on

  success "Session created"
  echo -e "\n  ${CYAN}╔══════════╦══════════╗${NC}"
  echo -e "  ${CYAN}║${NC} api      ${CYAN}║${NC} web      ${CYAN}║${NC}"
  echo -e "  ${CYAN}╠══════════╬══════════╣${NC}"
  echo -e "  ${CYAN}║${NC} inngest  ${CYAN}║${NC} dashboard${CYAN}║${NC}"
  echo -e "  ${CYAN}╚══════════╩══════════╝${NC}\n"
  sleep 1
  exec tmux attach -t "$SESSION"
}

# --- Main: stop --------------------------------------------------------------
cmd_stop() {
  header "🛑 Stopping voice-ai-copilot dev environment"
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    step "Killing tmux session..."
    tmux kill-session -t "$SESSION" 2>/dev/null || true
    success "tmux session stopped"
  else
    info "No tmux session running"
  fi
  # Reap orphaned service processes. A crashed watcher can outlive its pane
  # and keep holding :8000, so kill-session alone misses it. Only touch ports
  # we own (web port is the one we pinned, never a bystander's 5173).
  for port in 8000 8288 "$(web_port)"; do
    pids="$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      step "Freeing port $port..."
      kill $pids 2>/dev/null || true
    fi
  done
  cd "$REPO_ROOT"
  # Always attempt the graceful stop — don't gate on `supabase status`. A
  # partially-up or unhealthy stack makes status exit non-zero while its
  # containers are very much still running, and gating here used to skip the
  # stop entirely and leave everything up.
  step "Stopping Supabase..."
  supabase stop >/dev/null 2>&1 || warn "supabase stop failed — force-sweeping containers"

  # Force-sweep any lingering project containers regardless of what stop did.
  # Derive the project label from a live container instead of assuming it
  # equals "$SESSION" — the Supabase CLI labels by directory basename, so a
  # repo cloned into a differently-named folder would never match a hardcoded
  # filter. Fall back to $SESSION when nothing is running.
  local project
  project="$(docker ps -a --filter "label=com.supabase.cli.project" \
    --format '{{.Label "com.supabase.cli.project"}}' 2>/dev/null | head -n1)"
  project="${project:-$SESSION}"
  leftover=$(docker ps -aq --filter "label=com.supabase.cli.project=$project" 2>/dev/null)
  if [ -n "$leftover" ]; then
    step "Removing lingering Supabase containers (project: $project)..."
    # Clear the restart:unless-stopped policy first so Docker can't resurrect a
    # container in the gap between stop and rm.
    docker update --restart=no $leftover >/dev/null 2>&1 || true
    docker rm -f $leftover >/dev/null 2>&1 || warn "Failed to remove lingering containers"
    success "Lingering containers removed"
  else
    success "Supabase stopped"
  fi
  rm -f /tmp/copilot_dashboard.sh "$PORT_FILE"
  echo ""; success "Cleanup complete 🧹"
}

# --- Main: status ------------------------------------------------------------
port_up() { lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1; }
row() { # $1 label, $2 up?, $3 detail
  if [ "$2" = "1" ]; then echo -e "  ${GREEN}✅ ${1}${NC}\t$3"
  else echo -e "  ${RED}❌ ${1}${NC}\tnot running"; fi
}
cmd_status() {
  echo -e "\n${CYAN}${BOLD}voice-ai-copilot status${NC}\n"
  tmux has-session -t "$SESSION" 2>/dev/null && row "tmux    " 1 "session '$SESSION'" || row "tmux    " 0
  port_up 8000  && row "api     " 1 "http://localhost:8000"  || row "api     " 0
  local wp; wp="$(web_port)"
  port_up "$wp" && row "web     " 1 "http://localhost:$wp"   || row "web     " 0
  port_up 8288  && row "inngest " 1 "http://localhost:8288"  || row "inngest " 0
  ( cd "$REPO_ROOT" && supabase status >/dev/null 2>&1 ) && row "supabase" 1 "http://localhost:54323" || row "supabase" 0
  echo ""
}

# --- Main: urls / open / logs ------------------------------------------------
cmd_urls() {
  echo -e "\n${CYAN}${BOLD}voice-ai-copilot URLs${NC}\n"
  echo -e "  ${WHITE}API${NC}            http://localhost:8000"
  echo -e "  ${WHITE}Health matrix${NC}  http://localhost:8000/health/matrix"
  echo -e "  ${WHITE}Dashboard${NC}      http://localhost:$(web_port)"
  echo -e "  ${WHITE}Inngest${NC}        http://localhost:8288"
  echo -e "  ${WHITE}Supabase${NC}       http://localhost:54323\n"
}
cmd_open() {
  case "${1:-web}" in
    api|backend)      open "http://localhost:8000/health/matrix" ;;
    web|frontend)     open "http://localhost:$(web_port)" ;;
    inngest)          open "http://localhost:8288" ;;
    studio|supabase)  open "http://localhost:54323" ;;
    *) die "Unknown service '$1' (api|web|inngest|studio)" ;;
  esac
}
cmd_logs() {
  tmux has-session -t "$SESSION" 2>/dev/null || die "No session — start with: make dev"
  local svc="${1:-api}" idx
  idx="$(tmux list-panes -t "$SESSION" -F "#{pane_index} #{pane_title}" | awk -v s="$svc" '$2==s{print $1}')"
  [ -n "$idx" ] || die "Unknown pane '$svc' (api|web|inngest|dashboard)"
  echo -e "${CYAN}${BOLD}Logs: $svc${NC} ${BLUE}(last 100 lines)${NC}\n"
  tmux capture-pane -t "$SESSION.$idx" -p -S -100
}

# --- Dispatch ----------------------------------------------------------------
case "${1:-dev}" in
  dev)    cmd_dev ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  urls)   cmd_urls ;;
  open)   cmd_open "${2:-}" ;;
  logs)   cmd_logs "${2:-}" ;;
  *) die "Unknown command '$1' (dev|stop|status|urls|open|logs)" ;;
esac
