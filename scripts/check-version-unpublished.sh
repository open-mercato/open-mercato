#!/bin/bash
# Fail when the release version is already on npm for any public package.
# Publishing is irreversible, so this runs before any release side effect.
# Usage: ./scripts/check-version-unpublished.sh [version]
set -euo pipefail

VERSION="${1:-$(jq -r '.version' package.json)}"

PACKAGE_NAMES=$(find packages -maxdepth 2 -name package.json -not -path "*/node_modules/*" -print0 \
  | xargs -0 jq -r 'select(.private != true) | .name')

if [ -z "$PACKAGE_NAMES" ]; then
  echo "ERROR: no public packages found to check"
  exit 1
fi

ALREADY_PUBLISHED=$(echo "$PACKAGE_NAMES" | xargs -P 8 -I{} \
  sh -c 'npm view "{}@'"$VERSION"'" version > /dev/null 2>&1 && echo "{}"' || true)

if [ -n "$ALREADY_PUBLISHED" ]; then
  echo "ERROR: version $VERSION is already published on npm for:"
  echo "$ALREADY_PUBLISHED" | sed 's/^/  - /'
  echo "Bump to a new version before releasing; npm versions cannot be republished."
  echo "To resume a partially published release on purpose, re-run the workflow with resume=true."
  exit 1
fi

echo "Version $VERSION is not published yet on any public package."
