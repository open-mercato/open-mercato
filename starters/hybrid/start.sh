#!/usr/bin/env bash
# Start the hybrid dev stack: infra containers up, then `yarn dev` in the
# foreground (app + MCP server). Ctrl+C stops the host processes; the
# containers keep running (stop them with stop.sh).
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node starters/lib/start.mjs "$@"
