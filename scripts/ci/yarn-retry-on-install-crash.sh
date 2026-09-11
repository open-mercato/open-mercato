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
# so real errors surface fast. The signal is a *raw* Node stack frame pointing
# into yarn's own bundle. Yarn reports genuine problems as `YN####` diagnostics
# and prefixes every line it prints — including the stack of a YN0001 exception —
# with that code, so an unprefixed `at .../yarn.js:LINE:COL` frame means yarn
# crashed rather than diagnosed. A broken lockfile, a missing descriptor or an
# `--immutable` violation therefore still fails on the first attempt.
#
# Usage: yarn-retry-on-install-crash.sh <command> [args...]
# Tunables (env): YARN_CRASH_MAX_ATTEMPTS (default 3), YARN_CRASH_RETRY_SLEEP (default 5s)
set -uo pipefail

MAX_ATTEMPTS="${YARN_CRASH_MAX_ATTEMPTS:-3}"
SLEEP_SECONDS="${YARN_CRASH_RETRY_SLEEP:-5}"

# A Node stack frame into yarn's bundle that yarn's own reporter did not print.
YARN_CRASH_PATTERN='^[[:space:]]*at .*[/\]yarn\.js:[0-9]+:[0-9]+'

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

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::error::\`$*\` crashed inside yarn ${MAX_ATTEMPTS} times in a row; giving up. A crash this repeatable is unlikely to be the p-cancelable race — check the runner and the corepack cache." >&2
    exit "$code"
  fi

  echo "yarn crashed internally (not a reported error) — attempt ${attempt}/${MAX_ATTEMPTS} failed; retrying in ${SLEEP_SECONDS}s..."
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done
