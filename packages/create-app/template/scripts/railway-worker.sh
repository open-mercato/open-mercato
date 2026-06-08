#!/bin/sh
set -euo pipefail

export CACHE_STRATEGY="${CACHE_STRATEGY:-redis}"
export CACHE_REDIS_URL="${CACHE_REDIS_URL:-${REDIS_URL:-}}"
export QUEUE_STRATEGY=async
export NEXT_PUBLIC_QUEUE_STRATEGY=async
export AUTO_SPAWN_WORKERS=false
export OM_AUTO_SPAWN_WORKERS=false

if [ ! -d ".mercato/generated" ]; then
  yarn generate
fi

exec yarn mercato queue worker --all
