#!/usr/bin/env bash
set -uo pipefail

MAX_ATTEMPTS="${NPM_METADATA_MAX_ATTEMPTS:-180}"
SLEEP_SECONDS="${NPM_METADATA_RETRY_SLEEP:-10}"

if [ "$#" -lt 2 ]; then
  echo "::error::npm-wait-for-metadata.sh requires a version and at least one package" >&2
  exit 2
fi

if ! [[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || ! [[ "$SLEEP_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "::error::npm metadata wait settings must be non-negative integers and attempts must be at least 1" >&2
  exit 2
fi

version="$1"
shift

echo "Waiting for Open Mercato packages @ ${version} on npm..."
for package_name in "$@"; do
  echo "Checking ${package_name}@${version}..."
  attempt=1
  while :; do
    if npm view "${package_name}@${version}" version >/dev/null 2>&1; then
      echo "  ${package_name} available after attempt ${attempt}"
      break
    fi

    if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
      echo "::error::Package ${package_name}@${version} metadata is still unavailable after $((MAX_ATTEMPTS * SLEEP_SECONDS)) seconds" >&2
      exit 1
    fi

    echo "  Attempt ${attempt}/${MAX_ATTEMPTS}: waiting ${SLEEP_SECONDS}s..."
    attempt=$((attempt + 1))
    sleep "$SLEEP_SECONDS"
  done
done
