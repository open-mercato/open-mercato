#!/bin/bash
# Major release: bump major version, build, and publish with @latest tag
set -euo pipefail

if [ "${CI:-}" != "true" ]; then
  echo "==> Syncing create-app template from apps/mercato/src..."
  yarn template:sync:fix
else
  echo "==> Skipping template sync in CI"
fi

echo "==> Bumping major version..."
yarn workspaces foreach -A --no-private version major

echo "==> Building packages..."
yarn build:packages

echo "==> Generating..."
yarn generate

echo "==> Rebuilding packages with generated files..."
yarn build:packages

echo "==> Publishing with @latest tag..."
yarn workspaces foreach -A --no-private npm publish --access public

echo "==> Done!"
