#!/bin/bash
# Clean all node_modules, dist, and build artifacts from the entire monorepo

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "Cleaning node_modules, dist, and build artifacts..."

# Remove all node_modules directories
find . -type d -name 'node_modules' -prune -exec rm -rf {} + 2>/dev/null || true

# Remove all dist directories (build outputs)
find . -type d -name 'dist' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# Remove TypeScript incremental build info files
find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -exec rm -f {} + 2>/dev/null || true

# Also clean yarn/npm lock caches if needed
rm -rf .yarn/cache 2>/dev/null || true
rm -f .yarn/install-state.gz 2>/dev/null || true

echo "Done! All node_modules, dist, and .tsbuildinfo files removed."
echo "Run 'yarn install' to reinstall dependencies."
