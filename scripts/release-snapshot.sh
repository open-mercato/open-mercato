#!/bin/bash
# Snapshot release: version with prerelease channel, build identity, and commit hash
# Usage: ./scripts/release-snapshot.sh [channel] [--tag <tag>] [--channel <channel>]
set -euo pipefail

CHANNEL=""
TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel)
      CHANNEL="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: ./scripts/release-snapshot.sh [channel] [--tag <tag>] [--channel <channel>]"
      exit 0
      ;;
    --*)
      echo "Unknown option: $1"
      exit 1
      ;;
    *)
      if [ -z "$CHANNEL" ]; then
        CHANNEL="$1"
        shift
      else
        echo "Unexpected argument: $1"
        exit 1
      fi
      ;;
  esac
done

if [ -z "$CHANNEL" ]; then
  CHANNEL="$(git rev-parse --abbrev-ref HEAD)"
fi

if [ -z "$TAG" ]; then
  if [ "$CHANNEL" = "develop" ]; then
    TAG="develop"
  else
    TAG="canary"
  fi
fi

COMMIT_HASH=$(git rev-parse --short=10 HEAD)
BUILD_ID="${GITHUB_RUN_NUMBER:-$(date -u +%s)}"

if [ "${CI:-}" != "true" ]; then
  echo "==> Syncing create-app template from apps/mercato/src..."
  yarn template:sync:fix
else
  echo "==> Skipping template sync in CI"
fi

CURRENT_VERSION=$(jq -r '.version' packages/shared/package.json)
SNAPSHOT_VERSION=$(node scripts/lib/snapshot-release.mjs version \
  --current-version "$CURRENT_VERSION" \
  --channel "$CHANNEL" \
  --build-id "$BUILD_ID" \
  --commit-sha "$COMMIT_HASH")

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

echo "==> Publishing packages with dist-tag ${TAG}..."
./scripts/publish-packages.sh --tag "$TAG"
echo "==> Publish completed"

echo "==> Done!"
