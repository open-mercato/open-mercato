#!/bin/sh

# MCP server entrypoint for the containerized dev/prod stacks.
#
# The MCP container shares the app image (and, in dev, the app's bind mount
# plus node_modules/dist volumes) but must never run yarn install or builds —
# the app container owns those. Instead it waits until the app answers HTTP:
# per dev-entrypoint.sh ordering that means install, build:packages, generate,
# and init/migrate have all completed. Then it provisions the MCP API key into
# the shared volume file and starts the Streamable HTTP MCP server.
#
# Failure model: this script NEVER exits on failure. Exiting hands control to
# Docker's restart policy, which retries at most every ~1 minute forever — a
# permanent crash-restart churn that spams logs and burns CPU. Instead every
# failure (app never up, key provisioning error, server crash) is retried
# INTERNALLY with a growing backoff, so the container stays up, the last error
# stays readable at the end of `docker compose logs mcp`, and the healthcheck
# correctly reports unhealthy until the server actually serves.

APP_WAIT_URL="${APP_URL:-http://app:3000}"
TIMEOUT="${MCP_WAIT_FOR_APP_TIMEOUT:-1800}"
KEY_FILE="${MCP_SERVER_API_KEY_FILE:-${MCP_API_KEY_FILE:-/run/mcp-shared/mcp-api-key}}"
PORT="${MCP_PORT:-3001}"

DEBUG_FLAG=""
if [ "${MCP_DEBUG}" = "true" ]; then
  DEBUG_FLAG="--debug"
fi

# Let `docker stop` terminate promptly: the server runs as a background child
# so the shell can receive TERM/INT between waits and take the trap.
server_pid=""
trap 'if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null; fi; exit 0' TERM INT

wait_for_app() {
  echo "[mcp] Waiting for app at ${APP_WAIT_URL} (timeout ${TIMEOUT}s)..."
  elapsed=0
  # The 5s AbortSignal keeps each attempt bounded — a wedged-but-listening app
  # would otherwise hang a single fetch and stall the wall-clock budget.
  until node -e "fetch(process.argv[1],{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))" "${APP_WAIT_URL}" >/dev/null 2>&1; do
    elapsed=$((elapsed + 5))
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
      echo "[mcp] Timed out after ${TIMEOUT}s waiting for the app. Check 'docker compose logs app'." >&2
      return 1
    fi
    if [ $((elapsed % 60)) -eq 0 ]; then
      echo "[mcp] Still waiting for app (${elapsed}s elapsed)..."
    fi
    sleep 5
  done
  echo "[mcp] App is reachable."
  return 0
}

attempt=0
while true; do
  if ! wait_for_app; then
    attempt=$((attempt + 1))
    delay=$((60 * attempt)); [ "$delay" -gt 300 ] && delay=300
    echo "[mcp] Retrying from the top in ${delay}s (attempt ${attempt})..." >&2
    sleep "$delay"
    continue
  fi

  cd /app/apps/mercato || { sleep 60; continue; }

  echo "[mcp] Ensuring MCP API key at ${KEY_FILE}..."
  if ! yarn mercato ai_assistant mcp:ensure-api-key --file "${KEY_FILE}"; then
    attempt=$((attempt + 1))
    delay=$((60 * attempt)); [ "$delay" -gt 300 ] && delay=300
    echo "[mcp] ==============================================================" >&2
    echo "[mcp] API key provisioning FAILED (see the error above). Common causes:" >&2
    echo "[mcp]   - database not initialized yet (app init still running/failed)" >&2
    echo "[mcp]   - OM_INIT_SUPERADMIN_EMAIL does not match the seeded superadmin" >&2
    echo "[mcp] Retrying in ${delay}s. This container will NOT crash-loop." >&2
    echo "[mcp] ==============================================================" >&2
    sleep "$delay"
    continue
  fi

  echo "[mcp] Starting MCP HTTP server on :${PORT}"
  server_started=$(date +%s)
  yarn mercato ai_assistant mcp:serve-http --port "${PORT}" ${DEBUG_FLAG} &
  server_pid=$!
  wait "$server_pid"
  server_code=$?
  server_pid=""

  # A long healthy run resets the backoff; a quick death grows it.
  server_uptime=$(( $(date +%s) - server_started ))
  if [ "$server_uptime" -ge 600 ]; then attempt=0; else attempt=$((attempt + 1)); fi
  delay=$((60 * attempt)); [ "$delay" -gt 300 ] && delay=300; [ "$delay" -lt 10 ] && delay=10
  echo "[mcp] MCP server exited (code ${server_code}, uptime ${server_uptime}s). Restarting internally in ${delay}s..." >&2
  sleep "$delay"
done
