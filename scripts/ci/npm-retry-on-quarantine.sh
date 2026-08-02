#!/usr/bin/env bash
# Retry a command that installs freshly published npm packages, tolerating
# npm's post-publish security QUARANTINE window.
#
# npm holds a newly published version for a malware scan (usually ~5 minutes,
# up to 15+ at peak) before it becomes installable, so a scaffold/install that
# runs immediately after the snapshot publish can fail even though the publish
# succeeded. That window clears on its own, so retry the *actual* install
# operation (the thing yarn/npm does) rather than a proxy probe — `npm pack`
# hits the CDN tarball and can report ready while the manifest check still
# fails. Only the quarantine signal is retried; any other failure exits
# immediately so real errors surface fast.
#
# Yarn's own client-side cooldown (`npmMinimalAgeGate`, default 1 day) reports
# the same word but is NOT a registry state — waiting cannot clear it inside a
# CI job. It is detected separately and fails fast with the fix.
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

  if grep -qE 'YN0016.*quarantined' "$log"; then
    echo "::error::\`$*\` hit yarn's minimum release age gate (npmMinimalAgeGate, default 1d), not npm's registry quarantine. Retrying cannot clear it — allow the freshly published scope via npmPreapprovedPackages in the consuming project's .yarnrc.yml." >&2
    exit "$code"
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
