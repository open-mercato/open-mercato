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

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

  echo "  Publishing $PKG_NAME@$PKG_VERSION..."
  cd "$PKG_PATH"

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
