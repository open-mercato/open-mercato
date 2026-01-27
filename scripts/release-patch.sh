#!/bin/bash
# Patch release: bump patch version, build, and publish with @latest tag
set -euo pipefail

echo "==> Bumping patch version..."
yarn workspaces foreach -A --no-private version patch

echo "==> Generating..."
yarn generate

echo "==> Building packages..."
yarn build:packages

echo "==> Publishing with @latest tag..."
yarn workspaces foreach -A --no-private npm publish --access public

echo "==> Done!"
