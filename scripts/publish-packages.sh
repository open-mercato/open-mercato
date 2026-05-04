#!/bin/bash
# Publish all non-private packages to npm registry using yarn pack to resolve workspace:* references.
# Usage: ./scripts/publish-packages.sh [--tag <tag>]
#   --tag: npm dist-tag (default: "latest")

set -euo pipefail

TAG="latest"
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag) TAG="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Provenance is only attested when the OIDC trusted-publisher config on npmjs.org
# matches the workflow's identity (repository + ref). For PR-triggered canary
# publishes the ref is `refs/pull/<n>/merge`, which won't match a trusted publisher
# pinned to `refs/heads/develop` or release tags — npm returns a confusing 404 PUT
# in that case. Keep provenance on for branch/tag pushes (develop, main, release-*)
# and the official release dist-tags, fall back to classic NPM_TOKEN auth otherwise.
PROVENANCE_FLAG="--provenance"
if [ -n "${GITHUB_EVENT_NAME:-}" ] && [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
  PROVENANCE_FLAG=""
  echo "==> Pull-request event detected; publishing without --provenance to keep canary builds reachable for forks of the npm trusted-publisher config."
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_REPOSITORY_URL="https://github.com/open-mercato/open-mercato"

# Collect non-private packages with topological ordering (dependencies first)
PACKAGES=$(yarn workspaces list --json --no-private 2>/dev/null | jq -r '.location' | grep '^packages/' || true)

if [ -z "$PACKAGES" ]; then
  echo "No packages found to publish"
  exit 1
fi

echo "==> Publishing packages with tag @${TAG}..."
echo ""

FAILED=()
for pkg_dir in $PACKAGES; do
  PKG_PATH="$ROOT_DIR/$pkg_dir"
  PKG_NAME=$(jq -r '.name' "$PKG_PATH/package.json" 2>/dev/null)
  PKG_VERSION=$(jq -r '.version' "$PKG_PATH/package.json" 2>/dev/null)
  PKG_REPOSITORY_URL=$(jq -r '.repository.url // empty' "$PKG_PATH/package.json" 2>/dev/null)

  echo "  Publishing $PKG_NAME@$PKG_VERSION..."
  cd "$PKG_PATH"

  if [ -z "$PKG_REPOSITORY_URL" ]; then
    echo "    ✗ Missing repository.url in $pkg_dir/package.json"
    FAILED+=("$PKG_NAME")
    cd "$ROOT_DIR"
    continue
  fi

  if [ "$PKG_REPOSITORY_URL" != "$EXPECTED_REPOSITORY_URL" ]; then
    echo "    ✗ Invalid repository.url in $pkg_dir/package.json: $PKG_REPOSITORY_URL"
    echo "      Expected: $EXPECTED_REPOSITORY_URL"
    FAILED+=("$PKG_NAME")
    cd "$ROOT_DIR"
    continue
  fi

  # Clean any existing tarballs
  rm -f *.tgz @open-mercato-*.tgz create-mercato-app-*.tgz 2>/dev/null || true

  # Use yarn pack to create tarball with workspace:* resolved to actual versions
  if ! yarn pack --out "package.tgz" >/dev/null 2>&1; then
    echo "    ✗ Failed to create tarball"
    FAILED+=("$PKG_NAME")
    cd "$ROOT_DIR"
    continue
  fi

  if [ -f "package.tgz" ]; then
    if npm publish "package.tgz" --access public --tag "$TAG" $PROVENANCE_FLAG 2>&1; then
      echo "    ✓ Published"
    else
      echo "    ✗ Failed to publish"
      FAILED+=("$PKG_NAME")
    fi
    rm -f "package.tgz"
  else
    echo "    ✗ No tarball created"
    FAILED+=("$PKG_NAME")
  fi

  cd "$ROOT_DIR"
done

echo ""

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "==> Failed to publish: ${FAILED[*]}"
  exit 1
fi

echo "==> All packages published successfully!"
