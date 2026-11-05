#!/bin/sh
set -e

cd /app
yarn install

yarn build:packages
yarn generate
yarn build:packages

cd /app/apps/mercato

cd /app
exec yarn test:integration:ephemeral:start
