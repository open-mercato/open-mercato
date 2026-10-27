#!/bin/bash
# Publish all non-private packages to npm registry using yarn pack to resolve workspace:* references.
# Usage: ./scripts/publish-packages.sh [--tag <tag>] [--reconcile-tag]
#   --tag: npm dist-tag (default: "latest")
#   --reconcile-tag: also point --tag at packages whose version is already published, so a
#     resumed stable release leaves every package on the dist-tag that release resolved

set -euo pipefail

TAG="latest"
RECONCILE_TAG=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag) TAG="$2"; shift 2 ;;
    --reconcile-tag) RECONCILE_TAG=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

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

  if npm view "$PKG_NAME@$PKG_VERSION" version >/dev/null 2>&1; then
    echo "  Skipping $PKG_NAME@$PKG_VERSION (already published)"
    if [ "$RECONCILE_TAG" = true ]; then
      if npm dist-tag add "$PKG_NAME@$PKG_VERSION" "$TAG" >/dev/null 2>&1; then
        echo "    ✓ dist-tag $TAG → $PKG_VERSION"
      else
        echo "    ✗ Failed to point dist-tag $TAG at $PKG_VERSION"
        FAILED+=("$PKG_NAME")
      fi
    fi
    continue
  fi

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
    if npm publish "package.tgz" --access public --tag "$TAG" --provenance 2>&1; then
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
