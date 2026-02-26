#!/usr/bin/env bash
set -euo pipefail

echo "==> Syncing dependencies ..."
yarn install

echo "==> Installing skills ..."
if [ -f scripts/install-skills.sh ]; then
  bash scripts/install-skills.sh
else
  echo "    (install-skills.sh not found, skipping)"
fi

echo "==> Running database migrations ..."
if (cd apps/mercato && yarn db:migrate); then
  echo ""
  echo "Ready! Run: yarn dev"
else
  echo ""
  echo "WARNING: db:migrate failed. This may happen after rebasing across branches with new migrations."
  echo "         To wipe the database and reinitialize, run from the host terminal:"
  echo "           docker volume rm open-mercato_devcontainer_postgres_data"
  echo "         Then reopen in container."
  echo "         The container is still usable — open a terminal to investigate."
fi
