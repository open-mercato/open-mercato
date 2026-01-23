#!/bin/bash
# Canary release: version with commit hash, build, and publish
set -e

COMMIT_HASH=$(git rev-parse --short=10 HEAD)

echo "==> Bumping patch version..."
yarn workspaces foreach -A --no-private version patch

echo "==> Adding canary suffix (-canary-${COMMIT_HASH})..."
for pkg_json in packages/*/package.json; do
  is_private=$(jq -r '.private // false' "$pkg_json")
  [ "$is_private" = "true" ] && continue

  current=$(jq -r '.version' "$pkg_json")
  canary="${current}-canary-${COMMIT_HASH}"
  jq --arg v "$canary" '.version = $v' "$pkg_json" > tmp.$$ && mv tmp.$$ "$pkg_json"
  echo "  $(jq -r '.name' "$pkg_json"): $canary"
done

echo "==> Building packages..."
yarn build:packages

echo "==> Generating..."
yarn generate

echo "==> Rebuilding packages..."
yarn build:packages

echo "==> Publishing packages..."
yarn workspaces foreach -A --no-private npm publish --access public

echo "==> Done!"
