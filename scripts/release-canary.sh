#!/bin/bash
# Canary release: version with commit hash, build, and publish
set -e

COMMIT_HASH=$(git rev-parse --short=10 HEAD)

echo "==> Versioning packages with canary-${COMMIT_HASH}..."
for pkg_json in packages/*/package.json; do
  is_private=$(cat "$pkg_json" | jq -r '.private // false')
  if [ "$is_private" = "true" ]; then
    continue
  fi

  current_version=$(cat "$pkg_json" | jq -r '.version')
  pkg_name=$(cat "$pkg_json" | jq -r '.name')
  base_version=$(echo "$current_version" | sed -E 's/-.*$//')
  IFS='.' read -r major minor patch <<< "$base_version"
  new_patch=$((patch + 1))
  canary_version="${major}.${minor}.${new_patch}-canary-${COMMIT_HASH}"

  echo "  $pkg_name: $current_version -> $canary_version"
  tmp=$(mktemp)
  jq --arg v "$canary_version" '.version = $v' "$pkg_json" > "$tmp" && mv "$tmp" "$pkg_json"
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
