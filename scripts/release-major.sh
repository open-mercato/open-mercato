#!/bin/bash
# Major release: bump major version, build, and publish with @latest tag
set -e

echo "==> Bumping major version..."
yarn workspaces foreach -A --no-private version major

echo "==> Building packages..."
yarn build:packages

echo "==> Generating..."
yarn generate

echo "==> Rebuilding packages..."
yarn build:packages

echo "==> Publishing with @latest tag..."
yarn workspaces foreach -A --no-private npm publish --access public

echo "==> Done!"
