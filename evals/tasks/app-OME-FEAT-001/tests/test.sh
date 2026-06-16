#!/bin/bash
# Verifier entrypoint for app-OME-FEAT-001.
# Thin wrapper: the real orchestration (PASS_TO_PASS build/generate, FAIL_TO_PASS
# Playwright suite, ts-morph rubric, optional LLM judge, reward assembly) lives in
# verify.mjs. It writes:
#   - /logs/verifier/reward.json  (multi-dimensional reward consumed by Harbor)
#   - /logs/artifacts/<agent>-<run>.json  (full judge_output_schema record for S3)
set -uo pipefail

mkdir -p /logs/verifier /logs/artifacts

# Capture the resulting Open Mercato app (the agent's end-state) for later
# inspection. Done BEFORE verify.mjs so the snapshot excludes the hidden test
# spec the verifier injects. /logs/artifacts is a declared task artifact, so both
# files travel to S3 with the run record. Best-effort: never fail the verifier.
APP_DIR="${OM_EVAL_APP_DIR:-/app/eval-app}"
BASE_COMMIT="$(cat /opt/evals/base_commit 2>/dev/null || true)"
git -C "$APP_DIR" add -A >/dev/null 2>&1 || true
if [ -n "$BASE_COMMIT" ]; then
  # Reviewable diff vs the baseline scaffold; new files appear in full.
  git -C "$APP_DIR" diff --cached "$BASE_COMMIT" > /logs/artifacts/eval-app-changes.patch 2>/dev/null || true
fi
# Self-contained source snapshot (minus heavy/build dirs) so the app can be
# rebuilt and re-run from the artifact later.
tar -C "$APP_DIR" \
  --exclude='./node_modules' --exclude='./.next' --exclude='./.git' \
  --exclude='./dist' --exclude='./.turbo' \
  -czf /logs/artifacts/eval-app-src.tar.gz . 2>/dev/null || true

node /tests/verify.mjs
status=$?

# Fail-closed: if verify.mjs did not emit a reward, record a zero so the run is
# never silently counted as a pass.
if [ ! -f /logs/verifier/reward.json ] && [ ! -f /logs/verifier/reward.txt ]; then
  echo "[test.sh] verify.mjs produced no reward (exit ${status}); writing 0" >&2
  echo 0 > /logs/verifier/reward.txt
fi

exit 0
