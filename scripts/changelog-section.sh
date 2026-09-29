#!/bin/bash
# Print the CHANGELOG.md section for a release version, without its `# <version> (<date>)`
# heading — the GitHub Release is already titled with the version.
# Exits 1 when the version has no changelog entry, so a release can fail before publishing.
# Usage: ./scripts/changelog-section.sh [version] [--changelog <path>]
set -euo pipefail

VERSION=""
CHANGELOG="CHANGELOG.md"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --changelog) CHANGELOG="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: ./scripts/changelog-section.sh [version] [--changelog <path>]"
      exit 0
      ;;
    *)
      if [ -n "$VERSION" ]; then
        echo "Unexpected argument: $1" >&2
        exit 1
      fi
      VERSION="$1"
      shift
      ;;
  esac
done

VERSION="${VERSION:-$(jq -r '.version' package.json)}"

if [ ! -f "$CHANGELOG" ]; then
  echo "ERROR: $CHANGELOG not found" >&2
  exit 1
fi

# `index(...) == 1` keeps the match literal, so dots in the version are not treated as regex
SECTION=$(awk -v heading="# $VERSION (" '
  index($0, "# ") == 1 {
    if (found) exit
    if (index($0, heading) == 1) { found = 1; next }
  }
  found { print }
' "$CHANGELOG")

# Trim leading blank lines, then the section separator and trailing blank lines
SECTION=$(printf '%s\n' "$SECTION" | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;};/\n$/ba')
if [ "$(printf '%s\n' "$SECTION" | tail -n 1)" = "---" ]; then
  SECTION=$(printf '%s\n' "$SECTION" | sed '$d')
  SECTION=$(printf '%s\n' "$SECTION" | sed -e :a -e '/^\n*$/{$d;N;};/\n$/ba')
fi

if [ -z "$SECTION" ]; then
  echo "ERROR: no changelog entry for version $VERSION in $CHANGELOG" >&2
  echo "Add a '# $VERSION (YYYY-MM-DD)' section before releasing." >&2
  exit 1
fi

printf '%s\n' "$SECTION"
