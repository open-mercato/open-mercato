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

# Escape a value for safe embedding inside a JSON string (backslashes first).
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

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
    deepinfra)
      MODEL="deepinfra/zai-org/GLM-5.1"
      ;;
    groq)
      MODEL="groq/llama-3.3-70b-versatile"
      ;;
    together)
      MODEL="together/meta-llama/Llama-3.3-70B-Instruct-Turbo"
      ;;
    fireworks)
      MODEL="fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct"
      ;;
    *)
      # azure / litellm / ollama / lm-studio have no universal default — the
      # Windows configurator makes OM_AI_MODEL required for them, so this is a
      # last-resort fallback only.
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

# Resolve the provider's API key + base URL. Cloud OpenAI-compatible providers
# get a sensible default base URL when the operator leaves theirs blank; local
# backends default to host.docker.internal so the container can reach the host.
PROVIDER_KEY=""
PROVIDER_BASE_URL=""
case "$PROVIDER" in
  azure)      PROVIDER_KEY="${AZURE_OPENAI_API_KEY:-}"; PROVIDER_BASE_URL="${AZURE_OPENAI_BASE_URL:-}";;
  deepinfra)  PROVIDER_KEY="${DEEPINFRA_API_KEY:-}"; PROVIDER_BASE_URL="${DEEPINFRA_BASE_URL:-https://api.deepinfra.com/v1/openai}";;
  groq)       PROVIDER_KEY="${GROQ_API_KEY:-}"; PROVIDER_BASE_URL="${GROQ_BASE_URL:-https://api.groq.com/openai/v1}";;
  together)   PROVIDER_KEY="${TOGETHER_API_KEY:-}"; PROVIDER_BASE_URL="${TOGETHER_BASE_URL:-https://api.together.xyz/v1}";;
  fireworks)  PROVIDER_KEY="${FIREWORKS_API_KEY:-}"; PROVIDER_BASE_URL="${FIREWORKS_BASE_URL:-https://api.fireworks.ai/inference/v1}";;
  litellm)    PROVIDER_KEY="${LITELLM_API_KEY:-}"; PROVIDER_BASE_URL="${LITELLM_BASE_URL:-}";;
  ollama)     PROVIDER_KEY="${OLLAMA_API_KEY:-ollama}"; PROVIDER_BASE_URL="${OLLAMA_BASE_URL:-http://host.docker.internal:11434/v1}";;
  lm-studio)  PROVIDER_KEY="${LM_STUDIO_API_KEY:-lm-studio}"; PROVIDER_BASE_URL="${LM_STUDIO_BASE_URL:-http://host.docker.internal:1234/v1}";;
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
  azure | deepinfra | groq | together | fireworks | litellm | ollama | lm-studio)
    # Treat as an OpenAI-compatible endpoint (@ai-sdk/openai-compatible). The
    # key/baseURL are passed explicitly so OpenCode does not need a built-in
    # provider definition for the id.
    COMPAT_OPTIONS="\"apiKey\": \"$(json_escape "$PROVIDER_KEY")\""
    if [ -n "$PROVIDER_BASE_URL" ]; then
      COMPAT_OPTIONS="$COMPAT_OPTIONS, \"baseURL\": \"$(json_escape "$PROVIDER_BASE_URL")\""
    fi
    PROVIDER_CONFIG="\"$PROVIDER\": { \"npm\": \"@ai-sdk/openai-compatible\", \"options\": { $COMPAT_OPTIONS }, \"models\": { \"$MODEL_ID\": {} } }"
    ;;
  *)
    echo "Warning: Unknown provider '$PROVIDER', defaulting to anthropic"
    PROVIDER_CONFIG='"anthropic": {}'
    ;;
esac

# Build MCP headers
MCP_HEADERS='{}'
if [ -n "$MCP_API_KEY" ]; then
  MCP_HEADERS="{\"x-api-key\": \"$(json_escape "$MCP_API_KEY")\"}"
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
# Redact secrets before dumping: the OpenAI-compatible provider branch inlines
# the provider apiKey (and the MCP header carries the x-api-key), and container
# stdout ends up in `docker compose logs` / log collectors.
sed -E 's/("(apiKey|x-api-key)"[[:space:]]*:[[:space:]]*")([^"\\]|\\.)*/\1***REDACTED***/g' "$CONFIG_FILE"

# Execute OpenCode
exec opencode serve --hostname 0.0.0.0 --print-logs --log-level DEBUG
