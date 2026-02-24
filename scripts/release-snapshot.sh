#!/bin/bash
# Snapshot release: version with branch name and commit hash, build, and publish
set -euo pipefail

COMMIT_HASH=$(git rev-parse --short=10 HEAD)
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

# Get base version from shared package, bump patch, add branch suffix
BASE_VERSION=$(jq -r '.version' packages/shared/package.json | sed -E 's/-.*$//')
IFS='.' read -r major minor patch <<< "$BASE_VERSION"
SNAPSHOT_VERSION="${major}.${minor}.$((patch + 1))-${BRANCH_NAME}-${COMMIT_HASH}"

echo "==> Setting version to ${SNAPSHOT_VERSION}..."
yarn workspaces foreach -A --no-private version "$SNAPSHOT_VERSION"
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
