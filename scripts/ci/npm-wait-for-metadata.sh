#!/usr/bin/env bash
set -uo pipefail

MAX_ATTEMPTS="${NPM_METADATA_MAX_ATTEMPTS:-270}"
MAX_WAIT_SECONDS="${NPM_METADATA_TIMEOUT_SECONDS:-2700}"
REQUEST_TIMEOUT_SECONDS="${NPM_METADATA_REQUEST_TIMEOUT:-30}"
SLEEP_SECONDS="${NPM_METADATA_RETRY_SLEEP:-10}"

if [ "$#" -lt 2 ]; then
  echo "::error::npm-wait-for-metadata.sh requires a version and at least one package" >&2
  exit 2
fi

if ! [[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] \
  || ! [[ "$MAX_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] \
  || ! [[ "$REQUEST_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] \
  || ! [[ "$SLEEP_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "::error::npm metadata wait settings must be integers; attempts, timeout, and request timeout must be at least 1" >&2
  exit 2
fi

version="$1"
shift
deadline=$((SECONDS + MAX_WAIT_SECONDS))

fail_deadline() {
  echo "::error::npm metadata is still unavailable; the global ${MAX_WAIT_SECONDS}-second deadline expired" >&2
  exit 1
}

echo "Waiting for Open Mercato packages @ ${version} on npm..."
for package_name in "$@"; do
  echo "Checking ${package_name}@${version}..."
  attempt=1
  while :; do
    remaining=$((deadline - SECONDS))
    if [ "$remaining" -le 0 ]; then
      fail_deadline
    fi

    request_timeout="$REQUEST_TIMEOUT_SECONDS"
    if [ "$request_timeout" -gt "$remaining" ]; then
      request_timeout="$remaining"
    fi
    if timeout --signal=TERM "${request_timeout}s" npm view "${package_name}@${version}" version >/dev/null 2>&1; then
      echo "  ${package_name} available after attempt ${attempt}"
      break
    fi

    remaining=$((deadline - SECONDS))
    if [ "$remaining" -le 0 ]; then
      fail_deadline
    fi

    if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
      echo "::error::Package ${package_name}@${version} metadata is still unavailable after ${MAX_ATTEMPTS} attempts" >&2
      exit 1
    fi

    sleep_seconds="$SLEEP_SECONDS"
    if [ "$sleep_seconds" -gt "$remaining" ]; then
      sleep_seconds="$remaining"
    fi
    echo "  Attempt ${attempt}/${MAX_ATTEMPTS}: waiting ${sleep_seconds}s (${remaining}s global budget remaining)..."
    attempt=$((attempt + 1))
    if [ "$sleep_seconds" -gt 0 ]; then
      sleep "$sleep_seconds"
    fi
  done
done
