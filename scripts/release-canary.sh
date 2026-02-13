#!/bin/bash
# Canary release: version with commit hash, build, and publish
set -euo pipefail

COMMIT_HASH=$(git rev-parse --short=10 HEAD)

# Get base version from shared package, bump patch, add canary suffix
BASE_VERSION=$(jq -r '.version' packages/shared/package.json | sed -E 's/-.*$//')
IFS='.' read -r major minor patch <<< "$BASE_VERSION"
CANARY_VERSION="${major}.${minor}.$((patch + 1))-canary-${COMMIT_HASH}"

echo "==> Setting version to ${CANARY_VERSION}..."
yarn workspaces foreach -A --no-private version "$CANARY_VERSION"
echo "==> Version set successfully"

echo "==> Building packages..."
yarn build:packages
echo "==> Build completed"

echo "==> Generating..."
yarn generate
echo "==> Generate completed"

echo "==> Rebuilding packages with generated files..."
yarn build:packages
echo "==> Rebuild completed"

echo "==> Publishing packages..."
yarn workspaces foreach -Av --topological --no-private npm publish --access public
echo "==> Publish completed"

echo "==> Done!"
