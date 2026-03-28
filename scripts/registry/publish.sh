#!/bin/bash
# Republish all packages to local Verdaccio registry (removes existing versions first)
# Usage: ./scripts/registry/republish.sh

set -e

REGISTRY_URL="${VERDACCIO_URL:-http://localhost:4873}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Build local prerelease suffix from git branch + short SHA
BRANCH=$(cd "$ROOT_DIR" && git rev-parse --abbrev-ref HEAD 2>/dev/null | sed 's/[^a-zA-Z0-9]/-/g')
SHORT_SHA=$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null)
LOCAL_TAG="local.${BRANCH}.${SHORT_SHA}"

# Check if registry is running
if ! curl -s "$REGISTRY_URL/-/ping" > /dev/null 2>&1; then
  echo "Error: Verdaccio registry is not running at $REGISTRY_URL"
  echo "Run 'docker compose up -d verdaccio' first"
  exit 1
fi

# Check auth before spending time on builds
if ! npm whoami --registry "$REGISTRY_URL" > /dev/null 2>&1; then
  echo "Error: Not authenticated to Verdaccio at $REGISTRY_URL"
  echo "Run: npm login --registry $REGISTRY_URL"
  exit 1
fi

# Define packages in dependency order
PACKAGES=(
  "shared"
  "events"
  "cache"
  "queue"
  "ui"
  "core"
  "gateway-stripe"
  "search"
  "content"
  "onboarding"
  "ai-assistant"
  "scheduler"
  "cli"
  "create-app"
)

echo "=========================================="
echo "  Republishing to Verdaccio"
echo "  Registry: $REGISTRY_URL"
echo "  Version suffix: -$LOCAL_TAG"
echo "=========================================="
echo ""

# Step 1: Unpublish all existing local versions
echo "Step 1: Removing existing packages..."
for pkg in "${PACKAGES[@]}"; do
  PKG_NAME=$(jq -r '.name' "$ROOT_DIR/packages/$pkg/package.json" 2>/dev/null)
  VERSION=$(jq -r '.version' "$ROOT_DIR/packages/$pkg/package.json" 2>/dev/null)
  if [ -n "$VERSION" ] && [ "$VERSION" != "null" ] && [ -n "$PKG_NAME" ] && [ "$PKG_NAME" != "null" ]; then
    LOCAL_VERSION="${VERSION}-${LOCAL_TAG}"
    echo "  Unpublishing $PKG_NAME@$LOCAL_VERSION..."
    npm unpublish "$PKG_NAME@$LOCAL_VERSION" --registry "$REGISTRY_URL" --force 2>/dev/null || true
  fi
done
echo ""

# Step 2: Build all packages (nuke turbo cache to avoid stale dist/)
echo "Step 2: Building packages..."
cd "$ROOT_DIR"
rm -rf "$ROOT_DIR/.turbo" "$ROOT_DIR/node_modules/.cache/turbo"
yarn build:packages
echo ""

# Step 3: Publish all packages with local prerelease version
echo "Step 3: Publishing packages..."
for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="$ROOT_DIR/packages/$pkg"
  PKG_JSON="$PKG_DIR/package.json"
  PKG_NAME=$(jq -r '.name' "$PKG_JSON" 2>/dev/null)
  ORIG_VERSION=$(jq -r '.version' "$PKG_JSON" 2>/dev/null)
  LOCAL_VERSION="${ORIG_VERSION}-${LOCAL_TAG}"

  if [ -d "$PKG_DIR" ]; then
    echo "  Publishing $PKG_NAME@$LOCAL_VERSION..."
    cd "$PKG_DIR"

    # Temporarily set local version in package.json
    jq --arg v "$LOCAL_VERSION" '.version = $v' "$PKG_JSON" > "$PKG_JSON.tmp" && mv "$PKG_JSON.tmp" "$PKG_JSON"

    # Clean any existing tarballs
    rm -f *.tgz @open-mercato-*.tgz create-mercato-app-*.tgz 2>/dev/null

    # Use yarn pack to create tarball with workspace:* resolved
    yarn pack --out "package.tgz" >/dev/null 2>&1

    if [ -f "package.tgz" ]; then
      npm publish "package.tgz" --registry "$REGISTRY_URL" --access public --tag local
      rm -f "package.tgz"
      echo "    ✓ Published"
    else
      echo "    ✗ Failed to create tarball"
    fi

    # Restore original version
    jq --arg v "$ORIG_VERSION" '.version = $v' "$PKG_JSON" > "$PKG_JSON.tmp" && mv "$PKG_JSON.tmp" "$PKG_JSON"

    cd "$ROOT_DIR"
  fi
done

echo ""
echo "=========================================="
echo "  Done! View packages at: $REGISTRY_URL"
echo "=========================================="
