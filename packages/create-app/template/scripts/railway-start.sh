#!/bin/sh
set -euo pipefail

export CACHE_STRATEGY="${CACHE_STRATEGY:-redis}"
export CACHE_REDIS_URL="${CACHE_REDIS_URL:-${REDIS_URL:-}}"
export QUEUE_STRATEGY="${QUEUE_STRATEGY:-async}"
export NEXT_PUBLIC_QUEUE_STRATEGY="${NEXT_PUBLIC_QUEUE_STRATEGY:-async}"

sh ./docker/scripts/init-or-migrate.sh

if [ ! -d ".mercato/generated" ]; then
  yarn generate
fi

exec yarn start
