#!/bin/sh
set -e

# Build packages, then generate (writes packages/core/generated/), then rebuild so core gets dist/generated/
cd /app
yarn build:packages
yarn generate
yarn build:packages

cd /app/apps/mercato
if [ ! -f /tmp/init-marker/.seeded ]; then
  echo "First run: full initialization..."
  yarn mercato init
  mkdir -p /tmp/init-marker
  touch /tmp/init-marker/.seeded
else
  echo "Subsequent run: migrations only..."
  yarn db:migrate
fi

cd /app
exec yarn dev
