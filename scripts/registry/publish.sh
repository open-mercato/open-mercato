#!/bin/bash
# Republish all packages to local Verdaccio registry (removes existing versions first)
# Usage: ./scripts/registry/publish.sh

set -euo pipefail

REGISTRY_URL="${VERDACCIO_URL:-http://localhost:4873}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
NPMRC_TMP="$(mktemp "${TMPDIR:-/tmp}/open-mercato-verdaccio-npmrc.XXXXXX")"
REGISTRY_AUTH_KEY="${REGISTRY_URL#http://}"
REGISTRY_AUTH_KEY="${REGISTRY_AUTH_KEY#https://}"
REGISTRY_AUTH_KEY="${REGISTRY_AUTH_KEY%/}/"

cleanup() {
  rm -f "$NPMRC_TMP"
}

trap cleanup EXIT

read_package_json_field() {
  local manifest="$1"
  local field="$2"

  node -e '
    const fs = require("node:fs");
    const [manifestPath, fieldPath] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const value = fieldPath.split(".").reduce((current, key) => current == null ? undefined : current[key], data);
    if (value === undefined || value === null) {
      process.exit(0);
    }
    if (typeof value === "object") {
      process.stdout.write(JSON.stringify(value));
    } else {
      process.stdout.write(String(value));
    }
  ' "$manifest" "$field"
}

reset_verdaccio_storage() {
  docker compose rm -sf verdaccio > /dev/null 2>&1 || true
  docker volume rm -f mercato-verdaccio-storage mercato-verdaccio-plugins > /dev/null 2>&1 || true
}

wait_for_verdaccio() {
  local attempts=0
  local max_attempts=30

  until curl -s "$REGISTRY_URL/-/ping" > /dev/null 2>&1; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge "$max_attempts" ]; then
      echo "Error: Verdaccio did not become ready at $REGISTRY_URL"
      return 1
    fi

    sleep 1
  done
}

cat > "$NPMRC_TMP" <<EOF
//${REGISTRY_AUTH_KEY}:_auth=fake-local-verdaccio-auth
EOF

export NPM_CONFIG_USERCONFIG="$NPMRC_TMP"

echo "Bootstrapping Verdaccio at $REGISTRY_URL..."
cd "$ROOT_DIR"
reset_verdaccio_storage
docker compose up -d verdaccio > /dev/null
wait_for_verdaccio

PACKAGES=()
while IFS= read -r pkg_dir; do
  manifest="$pkg_dir/package.json"
  if [ ! -f "$manifest" ]; then
    continue
  fi

  is_private="$(read_package_json_field "$manifest" "private")"
  if [ "$is_private" = "true" ]; then
    continue
  fi

  PACKAGES+=("$(basename "$pkg_dir")")
done < <(find "$ROOT_DIR/packages" -mindepth 1 -maxdepth 1 -type d | sort)

echo "=========================================="
echo "  Republishing to Verdaccio"
echo "  Registry: $REGISTRY_URL"
echo "=========================================="
echo ""

# Step 1: Unpublish all existing versions
echo "Step 1: Removing existing packages..."
for pkg in "${PACKAGES[@]}"; do
  # Get actual package name and version from package.json
  PKG_NAME="$(read_package_json_field "$ROOT_DIR/packages/$pkg/package.json" "name")"
  VERSION="$(read_package_json_field "$ROOT_DIR/packages/$pkg/package.json" "version")"
  if [ -n "$VERSION" ] && [ "$VERSION" != "null" ] && [ -n "$PKG_NAME" ] && [ "$PKG_NAME" != "null" ]; then
    echo "  Unpublishing $PKG_NAME@$VERSION..."
    npm unpublish "$PKG_NAME@$VERSION" --registry "$REGISTRY_URL" --force 2>/dev/null || true
  fi
done
echo ""

# Step 2: Build all packages
echo "Step 2: Building packages..."
cd "$ROOT_DIR"
yarn build:packages
yarn generate
yarn build:packages
echo ""

# Step 3: Publish all packages
echo "Step 3: Publishing packages..."
for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="$ROOT_DIR/packages/$pkg"
  PKG_NAME="$(read_package_json_field "$PKG_DIR/package.json" "name")"

  if [ -d "$PKG_DIR" ]; then
    echo "  Publishing $PKG_NAME..."
    cd "$PKG_DIR"

    # Clean any existing tarballs
    rm -f *.tgz @open-mercato-*.tgz create-mercato-app-*.tgz 2>/dev/null

    # Use yarn pack to create tarball with workspace:* resolved
    yarn pack --out "package.tgz"

    if [ -f "package.tgz" ]; then
      npm publish "package.tgz" --registry "$REGISTRY_URL" --access public
      rm -f "package.tgz"
      echo "    ✓ Published"
    else
      echo "    ✗ Failed to create tarball"
    fi

    cd "$ROOT_DIR"
  fi
done

echo ""
echo "=========================================="
echo "  Done! View packages at: $REGISTRY_URL"
echo "=========================================="
