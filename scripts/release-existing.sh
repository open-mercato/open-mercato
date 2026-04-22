#!/bin/bash
# Stable release: publish the version already set in root package.json.
set -euo pipefail

if [ "${CI:-}" != "true" ]; then
  echo "==> Syncing create-app template from apps/mercato/src..."
  yarn template:sync:fix
else
  echo "==> Skipping template sync in CI"
fi

echo "==> Checking version alignment across packages against root package.json..."
./scripts/check-version-alignment.sh --reference package.json

RELEASE_VERSION=$(jq -r '.version' package.json)
echo "==> Releasing existing version ${RELEASE_VERSION}..."

echo "==> Building packages..."
yarn build:packages

echo "==> Generating..."
yarn generate

echo "==> Rebuilding packages with generated files..."
yarn build:packages

echo "==> Publishing with @latest tag..."
./scripts/publish-packages.sh

echo "==> Done!"
