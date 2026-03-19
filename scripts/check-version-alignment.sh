#!/bin/bash
# Check that all public packages have the same version as packages/shared.
# Exits with code 1 and prints mismatches if any are found.
set -euo pipefail

REFERENCE_VERSION=$(jq -r '.version' packages/shared/package.json)
MISMATCHED=()

while IFS= read -r pkg_json; do
  pkg_version=$(jq -r '.version' "$pkg_json")
  pkg_name=$(jq -r '.name' "$pkg_json")
  if [ "$pkg_version" != "$REFERENCE_VERSION" ]; then
    MISMATCHED+=("$pkg_name@$pkg_version (expected $REFERENCE_VERSION)")
  fi
done < <(find packages -maxdepth 2 -name package.json -not -path "*/node_modules/*" \
  | xargs -I{} sh -c 'jq -e ".private != true" {} > /dev/null 2>&1 && echo {}')

if [ ${#MISMATCHED[@]} -gt 0 ]; then
  echo "ERROR: The following packages are not aligned with the monorepo version ($REFERENCE_VERSION):"
  for m in "${MISMATCHED[@]}"; do echo "  - $m"; done
  echo "Fix their package.json versions before releasing."
  exit 1
fi

echo "All public packages are aligned at version $REFERENCE_VERSION."
