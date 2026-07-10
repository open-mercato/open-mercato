#!/bin/sh
# om-prepare-test-env: generated entrypoint (contract v2)
# regenerate with: om-prepare-test-env --regenerate
# history:
#   shipped by create-mercato-app (discovered mode: stops the mercato CLI's ephemeral owner + app;
#   testcontainers' ryuk reaps the DB containers). Also stops the `mercato server start` wrapper and
#   stale next-servers, and clears .mercato/server-start.lock — a surviving wrapper keeps the
#   single-instance guard locked and the next boot dies with "Another Open Mercato production
#   server is already running"
set -eu

STATE_FILE=".ai/qa/ephemeral-env.json"
ENV_DESCRIPTOR=".ai/qa/test-env.json"

say() { printf '%s\n' "$*"; }

# Stop the mercato CLI owner process (test:ephemeral) if alive.
owner_pid=$(pgrep -f 'mercato test:ephemeral|bin\.js test:ephemeral' 2>/dev/null | head -1 || true)
if [ -n "${owner_pid:-}" ]; then
  say "test-env-down: stopping ephemeral owner pid $owner_pid"
  kill "$owner_pid" 2>/dev/null || true
  sleep 2; kill -9 "$owner_pid" 2>/dev/null || true
fi

# Stop the `mercato server start` wrapper (owns the single-instance guard) and any
# stray next-servers left by failed boots of THIS app, then clear the guard lock.
for wrapper_pid in $(pgrep -f 'mercato server start' 2>/dev/null || true); do
  say "test-env-down: stopping server wrapper pid $wrapper_pid"
  kill "$wrapper_pid" 2>/dev/null || true
done
sleep 1
for stray_pid in $(pgrep -x next-server 2>/dev/null || true); do
  lsof -p "$stray_pid" 2>/dev/null | grep -q "$(pwd)" || continue
  say "test-env-down: stopping stray next-server pid $stray_pid"
  kill "$stray_pid" 2>/dev/null || true
  sleep 1; kill -9 "$stray_pid" 2>/dev/null || true
done
rm -f .mercato/server-start.lock

# Stop the app process bound to the recorded port.
if [ -f "$STATE_FILE" ]; then
  base=$(sed -n 's/.*"baseUrl": *"\([^"]*\)".*/\1/p' "$STATE_FILE" | head -1)
  port="${base##*:}"
  if [ -n "${port:-}" ]; then
    app_pid=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)
    if [ -n "${app_pid:-}" ]; then
      say "test-env-down: stopping app pid $app_pid on port $port"
      kill "$app_pid" 2>/dev/null || true
      sleep 2; kill -9 "$app_pid" 2>/dev/null || true
    fi
  fi
  rm -f "$STATE_FILE"
fi

# Ephemeral Postgres containers are testcontainers-managed; ryuk reaps them
# once their owner is gone. Never docker-rm containers this script did not create.

if [ -f "$ENV_DESCRIPTOR" ]; then
  tmp="$ENV_DESCRIPTOR.tmp"
  sed 's/"status": *"running"/"status": "stopped"/' "$ENV_DESCRIPTOR" > "$tmp" && mv "$tmp" "$ENV_DESCRIPTOR"
fi
say "TEST_ENV_STATUS=stopped"
