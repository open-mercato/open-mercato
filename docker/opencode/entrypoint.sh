#!/bin/bash
# OpenCode Dynamic Configuration Entrypoint
# Generates opencode.jsonc based on environment variables.
#
# Resolution order (highest precedence first):
#   1. OM_AI_PROVIDER / OM_AI_MODEL — new canonical variables for the unified
#      AI module. New deployments should set only these.
#   2. OPENCODE_PROVIDER / OPENCODE_MODEL — legacy aliases, kept as a
#      backward-compatibility fallback.
#   3. Built-in defaults: openai + openai/gpt-5-mini.
#
# OpenCode reads provider credentials from the matching provider environment
# variables, for example OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY.

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/home/opencode/.config/opencode}"
CONFIG_FILE="${CONFIG_DIR}/opencode.jsonc"

# Default values — OM_AI_* wins, OPENCODE_* is the BC fallback, defaults
# target OpenAI + gpt-5-mini.
PROVIDER="${OM_AI_PROVIDER:-${OPENCODE_PROVIDER:-openai}}"
MODEL="${OM_AI_MODEL:-${OPENCODE_MODEL:-}}"
MCP_URL="${OPENCODE_MCP_URL:-http://host.docker.internal:3001/mcp}"
MCP_API_KEY="${MCP_SERVER_API_KEY:-}"

# File-based key delivery for the fully containerized stack: when no key is
# set via env and MCP_SERVER_API_KEY_FILE points at the shared volume, wait
# for the MCP server's /health endpoint first — the MCP entrypoint only
# starts listening after mcp:ensure-api-key finished, so a healthy endpoint
# guarantees the file content is final for this boot. On timeout or read
# failure OpenCode still starts (headerless MCP config, matching the old
# no-key behavior) so /global/health stays available for diagnostics.
if [ -z "$MCP_API_KEY" ] && [ -n "${MCP_SERVER_API_KEY_FILE:-}" ]; then
  # Normalize before deriving the health URL: strip trailing slashes, then
  # the /mcp suffix, so http://mcp:3001/mcp and http://mcp:3001/mcp/ both
  # yield http://mcp:3001/health.
  MCP_BASE_URL="${MCP_URL%/}"
  MCP_HEALTH_URL="${MCP_BASE_URL%/mcp}/health"
  WAIT="${OPENCODE_MCP_KEY_WAIT_SECONDS:-1800}"
  echo "[OpenCode] Waiting for MCP at ${MCP_HEALTH_URL} and key file ${MCP_SERVER_API_KEY_FILE} (timeout ${WAIT}s)..."
  elapsed=0
  until curl -fsS --max-time 5 "$MCP_HEALTH_URL" >/dev/null 2>&1 && [ -r "$MCP_SERVER_API_KEY_FILE" ] && [ -s "$MCP_SERVER_API_KEY_FILE" ]; do
    elapsed=$((elapsed + 5))
    if [ "$elapsed" -ge "$WAIT" ]; then
      echo "[OpenCode] WARNING: timed out waiting for the MCP API key; starting WITHOUT MCP auth." >&2
      echo "[OpenCode] Check 'docker compose logs mcp', then 'docker compose restart opencode'." >&2
      break
    fi
    if [ $((elapsed % 60)) -eq 0 ]; then
      echo "[OpenCode] Still waiting for MCP (${elapsed}s elapsed)..."
    fi
    sleep 5
  done
  if [ -r "$MCP_SERVER_API_KEY_FILE" ]; then
    MCP_API_KEY="$(tr -d '[:space:]' < "$MCP_SERVER_API_KEY_FILE" || true)"
  fi
  if [ -n "$MCP_API_KEY" ]; then
    echo "[OpenCode] MCP API key loaded from file."
  else
    echo "[OpenCode] WARNING: MCP API key file is missing, empty, or unreadable — MCP requests will be unauthenticated (401s)." >&2
  fi
fi

# Determine model based on provider if not explicitly set
if [ -z "$MODEL" ]; then
  case "$PROVIDER" in
    anthropic)
      MODEL="anthropic/claude-haiku-4-5-20251001"
      ;;
    openai)
      MODEL="openai/gpt-5-mini"
      ;;
    google)
      MODEL="google/gemini-3-flash"
      ;;
    openrouter)
      MODEL="meta-llama/llama-3.3-70b-instruct"
      ;;
    *)
      MODEL="openai/gpt-5-mini"
      ;;
  esac
fi

MODEL_ID="$MODEL"
CONFIG_MODEL="$MODEL"
case "$MODEL" in
  "$PROVIDER"/*)
    MODEL_ID="${MODEL#"$PROVIDER"/}"
    ;;
  *)
    CONFIG_MODEL="$PROVIDER/$MODEL"
    ;;
esac

# Build provider configuration
case "$PROVIDER" in
  anthropic)
    PROVIDER_CONFIG='"anthropic": {}'
    ;;
  openai)
    PROVIDER_CONFIG='"openai": {}'
    ;;
  google)
    PROVIDER_CONFIG='"google": {}'
    ;;
  openrouter)
    OPENROUTER_OPTIONS=""
    if [ -n "${OPENROUTER_BASE_URL:-}" ]; then
      OPENROUTER_OPTIONS=", \"options\": { \"baseURL\": \"$OPENROUTER_BASE_URL\" }"
    fi
    PROVIDER_CONFIG="\"openrouter\": { \"models\": { \"$MODEL_ID\": {} }$OPENROUTER_OPTIONS }"
    ;;
  *)
    echo "Warning: Unknown provider '$PROVIDER', defaulting to anthropic"
    PROVIDER_CONFIG='"anthropic": {}'
    ;;
esac

# Build MCP headers
MCP_HEADERS='{}'
if [ -n "$MCP_API_KEY" ]; then
  MCP_HEADERS="{\"x-api-key\": \"$MCP_API_KEY\"}"
fi

# Generate config file
cat > "$CONFIG_FILE" << EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    $PROVIDER_CONFIG
  },
  "model": "$CONFIG_MODEL",
  "instructions": ["AGENTS.md"],
  "tools": {
    "write": false,
    "bash": false,
    "edit": false,
    "read": false,
    "glob": false,
    "grep": false,
    "todoread": false,
    "todowrite": false
  },
  "mcp": {
    "open-mercato": {
      "type": "remote",
      "url": "$MCP_URL",
      "headers": $MCP_HEADERS,
      "enabled": true
    }
  },
  "permission": {
   "bash": {
      "*": "deny"
   }
  },
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0"
  }
}
EOF

echo "[OpenCode] Configuration generated:"
echo "  Provider: $PROVIDER"
echo "  Model: $CONFIG_MODEL"
echo "  MCP URL: $MCP_URL"
cat "$CONFIG_FILE"

# Execute OpenCode
exec opencode serve --hostname 0.0.0.0 --print-logs --log-level DEBUG
