#!/bin/sh
set -e

cd /app

if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  echo "Installing dependencies..."
  yarn install
fi

if [ ! -f /tmp/init-marker/.seeded ]; then
  echo "First run: full initialization..."
  yarn initialize
  mkdir -p /tmp/init-marker
  touch /tmp/init-marker/.seeded
else
  echo "Subsequent run: migrations only..."
  yarn db:migrate
fi

exec yarn dev
