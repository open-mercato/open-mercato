#!/bin/sh
set -e

cd /app

if [ ! -d node_modules ] \
  || [ -z "$(ls -A node_modules 2>/dev/null)" ] \
  || [ ! -d node_modules/@open-mercato/cli ] \
  || [ ! -x node_modules/.bin/mercato ]; then
  echo "Installing dependencies..."
  yarn install
fi

sh /app/docker/scripts/init-or-migrate.sh

exec yarn dev
