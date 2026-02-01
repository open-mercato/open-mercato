#!/bin/sh
set -e

# Build packages first so CLI and app deps exist (dist may be empty from volume)
cd /app
yarn build:packages
yarn generate

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
