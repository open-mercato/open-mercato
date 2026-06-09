#!/bin/bash
# Verifier entrypoint for app-OME-FEAT-001.
# Thin wrapper: the real orchestration (PASS_TO_PASS build/generate, FAIL_TO_PASS
# Playwright suite, ts-morph rubric, optional LLM judge, reward assembly) lives in
# verify.mjs. It writes:
#   - /logs/verifier/reward.json  (multi-dimensional reward consumed by Harbor)
#   - /logs/artifacts/<agent>-<run>.json  (full judge_output_schema record for S3)
set -uo pipefail

mkdir -p /logs/verifier /logs/artifacts

node /tests/verify.mjs
status=$?

# Fail-closed: if verify.mjs did not emit a reward, record a zero so the run is
# never silently counted as a pass.
if [ ! -f /logs/verifier/reward.json ] && [ ! -f /logs/verifier/reward.txt ]; then
  echo "[test.sh] verify.mjs produced no reward (exit ${status}); writing 0" >&2
  echo 0 > /logs/verifier/reward.txt
fi

exit 0
