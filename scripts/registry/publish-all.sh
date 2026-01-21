#!/bin/bash
# Publish all packages to local Verdaccio registry

set -e

REGISTRY_URL="${VERDACCIO_URL:-http://localhost:4873}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Check if registry is running
if ! curl -s "$REGISTRY_URL/-/ping" > /dev/null 2>&1; then
  echo "Error: Verdaccio registry is not running at $REGISTRY_URL"
  echo "Run 'docker compose up -d verdaccio' first"
  exit 1
fi

# Build all packages first
echo "Building packages..."
yarn build:packages

# Define publish order (respecting dependencies)
PACKAGES=(
  "shared"
  "events"
  "cache"
  "queue"
  "ui"
  "core"
  "search"
  "content"
  "onboarding"
  "ai-assistant"
  "cli"
)

for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="$ROOT_DIR/packages/$pkg"
  if [ -d "$PKG_DIR" ]; then
    echo "Publishing @open-mercato/$pkg..."
    cd "$PKG_DIR"
    npm publish --registry "$REGISTRY_URL" --access public 2>&1 || echo "  -> Already published or error"
    cd "$ROOT_DIR"
  fi
done

echo ""
echo "All packages published to $REGISTRY_URL"
echo "View at: $REGISTRY_URL"
