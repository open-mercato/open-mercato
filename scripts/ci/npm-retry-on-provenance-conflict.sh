#!/usr/bin/env bash
set -uo pipefail

MAX_ATTEMPTS="${NPM_PROVENANCE_MAX_ATTEMPTS:-3}"
SLEEP_SECONDS="${NPM_PROVENANCE_RETRY_SLEEP:-5}"
TLOG_ERROR_PATTERN='TLOG_CREATE_ENTRY_ERROR'
TLOG_CONFLICT_PATTERN='\(409\) an equivalent entry already exists in the transparency log'

if [ "$#" -eq 0 ]; then
  echo "::error::npm-retry-on-provenance-conflict.sh requires a command to run" >&2
  exit 2
fi

if ! [[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || ! [[ "$SLEEP_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "::error::npm provenance retry settings must be non-negative integers and attempts must be at least 1" >&2
  exit 2
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

attempt=1
while :; do
  : > "$log"
  "$@" 2>&1 | tee "$log"
  code="${PIPESTATUS[0]}"

  if [ "$code" -eq 0 ]; then
    exit 0
  fi

  if ! grep -q "$TLOG_ERROR_PATTERN" "$log" || ! grep -qE "$TLOG_CONFLICT_PATTERN" "$log"; then
    echo "::error::npm publish failed with a non-retryable error; not retrying." >&2
    exit "$code"
  fi

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::error::npm provenance hit the Rekor duplicate-entry conflict ${MAX_ATTEMPTS} times; giving up." >&2
    exit "$code"
  fi

  echo "npm provenance hit a retry-after-success Rekor conflict — attempt ${attempt}/${MAX_ATTEMPTS} failed; retrying in ${SLEEP_SECONDS}s..."
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done
