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

CONFIG_DIR="/home/opencode/.config/opencode"
CONFIG_FILE="${CONFIG_DIR}/opencode.jsonc"

# Default values — OM_AI_* wins, OPENCODE_* is the BC fallback, defaults
# target OpenAI + gpt-5-mini.
PROVIDER="${OM_AI_PROVIDER:-${OPENCODE_PROVIDER:-openai}}"
MODEL="${OM_AI_MODEL:-${OPENCODE_MODEL:-}}"
MCP_URL="${OPENCODE_MCP_URL:-http://host.docker.internal:3001/mcp}"
MCP_API_KEY="${MCP_SERVER_API_KEY:-}"

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
    *)
      MODEL="openai/gpt-5-mini"
      ;;
  esac
fi

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
  "model": "$MODEL",
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
echo "  Model: $MODEL"
echo "  MCP URL: $MCP_URL"
cat "$CONFIG_FILE"

# Execute OpenCode
exec opencode serve --hostname 0.0.0.0 --print-logs --log-level DEBUG
