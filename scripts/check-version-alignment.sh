#!/bin/bash
# Check that all public packages and the app workspaces have the same version as the
# selected reference manifest.
# `apps/*` are private and never published, but they ship as the app shell of a release,
# so they move in lockstep too. Private `packages/*` (packages/eslint-plugin-ds) stay out.
# Exits with code 1 and prints mismatches if any are found.
set -euo pipefail

REFERENCE_FILE="packages/shared/package.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reference)
      REFERENCE_FILE="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: ./scripts/check-version-alignment.sh [--reference <package.json path>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

REFERENCE_VERSION=$(jq -r '.version' "$REFERENCE_FILE")
MISMATCHED=()

MANIFESTS=$(
  find packages -maxdepth 2 -name package.json -not -path "*/node_modules/*" \
    | xargs -I{} sh -c 'jq -e ".private != true" {} > /dev/null 2>&1 && echo {}'
  find apps -maxdepth 2 -name package.json -not -path "*/node_modules/*"
)

while IFS= read -r pkg_json; do
  [ -n "$pkg_json" ] || continue
  pkg_version=$(jq -r '.version' "$pkg_json")
  pkg_name=$(jq -r '.name' "$pkg_json")
  if [ "$pkg_version" != "$REFERENCE_VERSION" ]; then
    MISMATCHED+=("$pkg_name@$pkg_version (expected $REFERENCE_VERSION)")
  fi
done <<< "$MANIFESTS"

if [ ${#MISMATCHED[@]} -gt 0 ]; then
  echo "ERROR: The following workspaces are not aligned with the monorepo version ($REFERENCE_VERSION) from $REFERENCE_FILE:"
  for m in "${MISMATCHED[@]}"; do echo "  - $m"; done
  echo "Fix their package.json versions before releasing."
  exit 1
fi

echo "All public packages and app workspaces are aligned at version $REFERENCE_VERSION from $REFERENCE_FILE."
