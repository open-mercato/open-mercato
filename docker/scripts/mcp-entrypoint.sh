#!/bin/sh
set -e

# MCP server entrypoint for the containerized dev/prod stacks.
#
# The MCP container shares the app image (and, in dev, the app's bind mount
# plus node_modules/dist volumes) but must never run yarn install or builds —
# the app container owns those. Instead it waits until the app answers HTTP:
# per dev-entrypoint.sh ordering that means install, build:packages, generate,
# and init/migrate have all completed. Then it provisions the MCP API key into
# the shared volume file and starts the Streamable HTTP MCP server.

APP_WAIT_URL="${APP_URL:-http://app:3000}"
TIMEOUT="${MCP_WAIT_FOR_APP_TIMEOUT:-1800}"
KEY_FILE="${MCP_SERVER_API_KEY_FILE:-${MCP_API_KEY_FILE:-/run/mcp-shared/mcp-api-key}}"
PORT="${MCP_PORT:-3001}"

echo "[mcp] Waiting for app at ${APP_WAIT_URL} (timeout ${TIMEOUT}s)..."
elapsed=0
# The 5s AbortSignal keeps each attempt bounded — a wedged-but-listening app
# would otherwise hang a single fetch and stall the wall-clock budget.
until node -e "fetch(process.argv[1],{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))" "${APP_WAIT_URL}" >/dev/null 2>&1; do
  elapsed=$((elapsed + 5))
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "[mcp] Timed out after ${TIMEOUT}s waiting for the app. Check 'docker compose logs app'." >&2
    exit 1
  fi
  if [ $((elapsed % 60)) -eq 0 ]; then
    echo "[mcp] Still waiting for app (${elapsed}s elapsed)..."
  fi
  sleep 5
done
echo "[mcp] App is reachable."

cd /app/apps/mercato

echo "[mcp] Ensuring MCP API key at ${KEY_FILE}..."
yarn mercato ai_assistant mcp:ensure-api-key --file "${KEY_FILE}"

DEBUG_FLAG=""
if [ "${MCP_DEBUG}" = "true" ]; then
  DEBUG_FLAG="--debug"
fi

echo "[mcp] Starting MCP HTTP server on :${PORT}"
exec yarn mercato ai_assistant mcp:serve-http --port "${PORT}" ${DEBUG_FLAG}
