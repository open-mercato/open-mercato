#!/usr/bin/env bash
# Retry a command that installs freshly published npm packages, tolerating
# npm's post-publish security QUARANTINE window.
#
# npm quarantines a newly published version's tarball for a security scan while
# its metadata is already public. A scaffold/install that runs immediately after
# the snapshot publish therefore fails with `YN0016 … are quarantined` (yarn) or
# a 403 quarantine error (npm) even though `npm view <pkg> version` succeeds.
# The quarantine clears on its own after a while, so retry the *actual* install
# operation (the thing yarn/npm does) rather than a proxy probe — `npm pack`
# hits the CDN tarball and can report ready while yarn's manifest check still
# sees quarantine. Only the quarantine signal is retried; any other failure
# exits immediately so real errors surface fast.
#
# Usage: npm-retry-on-quarantine.sh <command> [args...]
# Tunables (env): QUARANTINE_MAX_ATTEMPTS (default 20), QUARANTINE_RETRY_SLEEP (default 60s)
set -uo pipefail

MAX_ATTEMPTS="${QUARANTINE_MAX_ATTEMPTS:-20}"
SLEEP_SECONDS="${QUARANTINE_RETRY_SLEEP:-60}"

if [ "$#" -eq 0 ]; then
  echo "::error::npm-retry-on-quarantine.sh requires a command to run" >&2
  exit 2
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

attempt=1
while :; do
  "$@" 2>&1 | tee "$log"
  code="${PIPESTATUS[0]}"

  if [ "$code" -eq 0 ]; then
    exit 0
  fi

  if ! grep -qiE 'quarantin' "$log"; then
    echo "::error::\`$*\` failed (exit ${code}) for a non-quarantine reason; not retrying." >&2
    exit "$code"
  fi

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::error::\`$*\` still hitting npm quarantine after ${MAX_ATTEMPTS} attempts (~$((MAX_ATTEMPTS * SLEEP_SECONDS / 60)) min); giving up." >&2
    exit "$code"
  fi

  echo "npm quarantine detected — attempt ${attempt}/${MAX_ATTEMPTS} failed; retrying in ${SLEEP_SECONDS}s..."
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done
