#!/usr/bin/env bash
# Retry a yarn command that died *inside yarn itself*, rather than failing the
# way yarn reports a real problem.
#
# Yarn bundles `got`, which bundles `p-cancelable`. A request timer can fire
# `timeout` on a promise that has already settled, and the cancellation handler
# throws instead of being ignored ("The `onCancel` handler was attached after
# the promise settled"). Nothing catches it, so the whole install dies as a Node
# uncaught exception a second or two in, naming no descriptor, package or
# lockfile entry. It is a race in the HTTP layer, and a plain rerun of the same
# commit passes.
#
# This cannot be fixed from configuration. `httpRetry` and `httpTimeout` live
# inside got's own retry logic, which an uncaught throw escapes, and yarn 4.18.0
# still ships the same bundled p-cancelable as the pinned 4.17.1 — so upgrading
# the package manager does not clear it either. Retrying the process is the only
# mitigation available to this repository.
#
# The retry is deliberately narrow, for the same reason npm-retry-on-quarantine.sh
# is: only the crash signal is retried, and any other failure exits immediately
# so real errors surface fast. The signal is a Node stack frame pointing into
# yarn's own bundle, i.e. `at .../yarn.js:LINE:COL` — but that frame alone is
# not enough: a real yarn-reported error (a broken lockfile, a missing
# descriptor, a connection failure) can *also* crash afterwards on the same
# `onCancel`/p-cancelable race once yarn's own reporter has already printed
# `YN0000: ... Failed with errors`. When that marker is present, the crash is
# collateral damage from a real, deterministic failure, not the transient race,
# so it is not retried — retrying it would just burn 3 attempts reproducing the
# same reported error. Only a crash with no such marker — yarn dying before it
# ever got to report anything — is the pure internal race this wrapper exists
# to retry.
#
# Usage: yarn-retry-on-install-crash.sh <command> [args...]
# Tunables (env): INSTALL_CRASH_MAX_ATTEMPTS (default 3), INSTALL_CRASH_RETRY_SLEEP (default 5s)
# (not YARN_-prefixed: yarn treats every YARN_* env var as configuration and
# refuses to run on ones it does not recognize.)
set -uo pipefail

MAX_ATTEMPTS="${INSTALL_CRASH_MAX_ATTEMPTS:-3}"
SLEEP_SECONDS="${INSTALL_CRASH_RETRY_SLEEP:-5}"

# A Node stack frame into yarn's bundle that yarn's own reporter did not print.
YARN_CRASH_PATTERN='^[[:space:]]*at .*[/\]yarn\.js:[0-9]+:[0-9]+'

# Yarn's own "I already reported a failure" marker. Present, the crash is
# fallout from a real reported error; absent, it is the bare internal crash.
YARN_REPORTED_FAILURE_PATTERN='YN0000:.*Failed with errors'

if [ "$#" -eq 0 ]; then
  echo "::error::yarn-retry-on-install-crash.sh requires a command to run" >&2
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

  if ! grep -qE "$YARN_CRASH_PATTERN" "$log"; then
    echo "::error::\`$*\` failed (exit ${code}) with a reported error rather than a yarn-internal crash; not retrying." >&2
    exit "$code"
  fi

  if grep -qE "$YARN_REPORTED_FAILURE_PATTERN" "$log"; then
    echo "::error::\`$*\` failed (exit ${code}) — yarn already reported a failure before crashing; not retrying." >&2
    exit "$code"
  fi

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::error::\`$*\` crashed inside yarn ${MAX_ATTEMPTS} times in a row; giving up. A crash this repeatable is unlikely to be the p-cancelable race — check the runner and the corepack cache." >&2
    exit "$code"
  fi

  echo "yarn crashed internally (not a reported error) — attempt ${attempt}/${MAX_ATTEMPTS} failed; retrying in ${SLEEP_SECONDS}s..."
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done
