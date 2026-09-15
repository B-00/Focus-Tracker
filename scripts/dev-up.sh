#!/usr/bin/env bash
# scripts/dev-up.sh
#
# One-command bring-up for the Focus Tracker dev stack. In order:
#   1. Docker Desktop        (launches if the engine isn't reachable, waits ≤60s)
#   2. Postgres              (docker compose up -d --wait postgres — idempotent)
#   3. API + web + desktop Vite in parallel, all in this terminal
#      with per-service log prefixes ([api] / [web] / [desktop]).
#
# ─────────────────────────────────────────────────────────────────────────────
# USAGE
# ─────────────────────────────────────────────────────────────────────────────
#   pnpm dev:up              # from repo root, preferred
#   bash scripts/dev-up.sh   # direct
#
# Ports it brings up:
#   3000  API           (@focus-tracker/api,     Nest + Prisma)
#   5173  web dashboard (@focus-tracker/web,     React + Vite)
#   1420  desktop UI    (@focus-tracker/desktop, Vite for the Tauri WebView)
#   5433  Postgres      (docker compose service `postgres`)
#
# Ctrl+C stops the three dev servers via `taskkill //F //T //PID …` on their
# process trees (pnpm spawns node children — you need //T to kill the whole
# tree, not just the pnpm parent). Postgres is deliberately left running so
# you don't lose warm connection pools / cached pages between sessions —
# use `pnpm db:down` to stop it explicitly.
#
# Idempotence: any dev server whose port is already LISTENING is skipped
# (with a warning line). Safe to re-run at any time — you'll only start what
# isn't already up. If all three ports are in use, the script exits early
# without waiting on anything.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS SCRIPT INTENTIONALLY DOES NOT DO
# ─────────────────────────────────────────────────────────────────────────────
#   • Launch focus-tracker-desktop.exe — start the Tauri app manually when
#     you actually want to use it. This script only brings up the Vite on
#     1420 that the app's WebView loads its UI from.
#   • Launch the Firefox extension (`pnpm --filter @focus-tracker/extension
#     dev`) — that pops a Firefox Developer Edition window each time, which
#     is noisy if you're not actively working on the extension.
#   • Run migrations. Use `pnpm db:migrate` if the schema has moved.
#   • Stop Postgres. Use `pnpm db:down`.
#
# ─────────────────────────────────────────────────────────────────────────────
# TROUBLESHOOTING
# ─────────────────────────────────────────────────────────────────────────────
#   • "port N already in use — skipping" but the server isn't actually up:
#     you have a zombie process. Find it with `netstat -ano | grep :N` then
#     `taskkill //F //PID <pid>`.
#   • "Docker engine did not become reachable in 60s": Docker Desktop is
#     probably hung / mid-update. Kill it in Task Manager, re-run.
#   • Wrong Docker install path: edit DOCKER_DESKTOP below (the only
#     hardcoded path in this script).
#
# ponytail: hardcoded Windows path; MSYS-bash-specific (`taskkill //T`).
# Portable across dev machines would need a `platform` case and PowerShell
# equivalents — not worth it for a personal-project dev script.

set -eu

DOCKER_DESKTOP="/c/Program Files/Docker/Docker/Docker Desktop.exe"

log() { echo "[dev-up] $*"; }

# ---------- 1. Docker engine ----------
if ! docker ps >/dev/null 2>&1; then
  log "Docker engine not reachable — launching Docker Desktop..."
  "$DOCKER_DESKTOP" >/dev/null 2>&1 &
  for i in {1..20}; do
    if docker ps >/dev/null 2>&1; then
      log "Docker engine ready (~$((i * 3))s)"
      break
    fi
    sleep 3
    if [ "$i" -eq 20 ]; then
      log "ERROR: Docker engine did not become reachable in 60s"
      exit 1
    fi
  done
else
  log "Docker engine already up"
fi

# ---------- 2. Postgres ----------
log "Ensuring Postgres is up (docker compose up -d --wait)..."
docker compose up -d --wait postgres

# ---------- 3. Dev servers ----------
port_in_use() {
  netstat -ano | grep -E "LISTENING" | grep -q ":$1 "
}

pids=()

cleanup() {
  echo
  log "Stopping dev servers (Postgres left running — use \`pnpm db:down\` to stop it)..."
  for pid in "${pids[@]}"; do
    # //T = kill child tree; //F = force. pnpm spawns node children, so we
    # need to kill the whole tree, not just the pnpm parent.
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  done
  exit 0
}
trap cleanup INT TERM

start() {
  # $1 port, $2 label, $3+ command
  local port=$1 label=$2
  shift 2
  if port_in_use "$port"; then
    log "port $port ($label) already in use — skipping"
    return
  fi
  log "Starting $label..."
  ( "$@" 2>&1 | sed "s/^/[$label] /" ) &
  pids+=($!)
}

start 3000 api     pnpm --filter @focus-tracker/api     dev
start 5173 web     pnpm --filter @focus-tracker/web     dev
start 1420 desktop pnpm --filter @focus-tracker/desktop exec vite

if [ "${#pids[@]}" -eq 0 ]; then
  log "All dev services already running. Nothing to start."
  exit 0
fi

log "All started. Press Ctrl+C to stop."
wait
