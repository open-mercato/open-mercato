#!/bin/bash
# Clean all generated files and directories
# - .mercato folder in Next.js apps
# - generated/ folders in packages
# - .turbo cache folders
# - .next build folders
# - migrations folders in dist directories

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "Cleaning generated files..."

# Clean .mercato folders (Next.js app generated files)
find . -type d -name '.mercato' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# Clean generated/ folders in packages and root
find . -type d -name 'generated' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# Clean .turbo cache folders
find . -type d -name '.turbo' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# Clean .next build folders
find . -type d -name '.next' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# Clean dist folders
find . -type d -path 'dist' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

echo "Done! Cleaned: .mercato, generated/, .turbo, .next, dist/"
