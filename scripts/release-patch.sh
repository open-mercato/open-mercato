#!/bin/bash
# Patch release: bump patch version, build, and publish with @latest tag
set -euo pipefail

if [ "${CI:-}" != "true" ]; then
  echo "==> Syncing create-app template from apps/mercato/src..."
  yarn template:sync:fix
else
  echo "==> Skipping template sync in CI"
fi

echo "==> Bumping patch version (packages + root manifest)..."
./scripts/bump-version.sh patch > /dev/null

echo "==> Verifying the target version is not published yet..."
./scripts/check-version-unpublished.sh

echo "==> Building packages..."
yarn build:packages

echo "==> Generating..."
yarn generate

echo "==> Rebuilding packages with generated files..."
yarn build:packages

echo "==> Publishing with @latest tag..."
./scripts/publish-packages.sh

echo "==> Done!"
