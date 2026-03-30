#!/bin/sh
set -e

# Ensure node_modules volume has all workspace symlinks (handles new packages added after volume creation)
cd /app

if [ -f /tmp/docker-exec-skip-rebuilt.skip ]; then
  echo "Skipping rebuild for this restart..."
  rm -f /tmp/docker-exec-skip-rebuilt.skip
  exec yarn dev
fi

yarn install

# Build packages, then generate (writes packages/core/generated/), then rebuild so core gets dist/generated/
yarn build:packages
yarn generate
yarn build:packages

cd /app/apps/mercato
INIT_COMMAND="yarn mercato init" sh /app/docker/scripts/init-or-migrate.sh

cd /app
exec yarn dev
