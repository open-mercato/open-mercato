#!/bin/bash
# Bump the monorepo version across all public packages, the app workspaces and the root manifest.
# Does not build, publish, commit or tag — see scripts/release-*.sh for those.
# Usage: ./scripts/bump-version.sh <patch|minor|major>
set -euo pipefail

BUMP="${1:-}"
case "$BUMP" in
  patch|minor|major) ;;
  *)
    echo "Usage: ./scripts/bump-version.sh <patch|minor|major>"
    exit 1
    ;;
esac

echo "==> Checking version alignment across packages..." >&2
./scripts/check-version-alignment.sh >&2

echo "==> Bumping $BUMP version..." >&2
yarn workspaces foreach -A --no-private version "$BUMP" >&2

NEW_VERSION=$(jq -r '.version' packages/shared/package.json)

echo "==> Syncing root package.json to $NEW_VERSION..." >&2
jq --arg version "$NEW_VERSION" '.version = $version' package.json > package.json.bump
mv package.json.bump package.json

# `yarn workspaces foreach --no-private` skips apps/* because they are private, but they ship
# as the app shell of a release and must carry the monorepo version like everything else.
while IFS= read -r app_json; do
  echo "==> Syncing $app_json to $NEW_VERSION..." >&2
  jq --arg version "$NEW_VERSION" '.version = $version' "$app_json" > "$app_json.bump"
  mv "$app_json.bump" "$app_json"
done < <(find apps -maxdepth 2 -name package.json -not -path "*/node_modules/*")

echo "==> Verifying alignment against root package.json..." >&2
./scripts/check-version-alignment.sh --reference package.json >&2

echo "$NEW_VERSION"
