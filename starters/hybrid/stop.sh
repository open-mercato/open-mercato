#!/usr/bin/env bash
# Stop the hybrid infra containers (data preserved). Pass `--volumes --yes`
# for a full destructive reset. Stop `yarn dev` itself with Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node starters/lib/stop.mjs "$@"
