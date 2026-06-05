# CI 2425 Stabilization

## Goal

Stabilize the develop branch feeding PR #2425 by fixing the failures observed in PR #2549 CI at root cause, then prove the integration suite is stable with two independent full ephemeral runs.

## Scope

- Fix the multi-select custom-field persistence failure in `TC-CRM-CF-MULTI-EDIT-001`.
- Fix the OSS optimistic-lock clean-save failure in `TC-LOCK-OSS-014`.
- Triage standalone integration failures from PR #2549 and split unrelated fixes into follow-up PRs if needed.

## Non-goals

- No timeout-only fixes.
- No broad test deletion or allowlisting.
- No local database migrations.

## Evidence

- PR #2549 CI run: `27017593992`
- Failed shards: `ephemeral-integration (8/15)`, `ephemeral-integration (9/15)`
- Snapshot standalone run: `27017594026`
- Downloaded artifacts: `/tmp/open-mercato-ci-2549`
- Full ephemeral run attempt 1 log: `/tmp/ci-2425-full-ephemeral-run-1.log` (invalid: exposed a retry in `TC-AI-INJECT-013`)
- Catalog AI targeted rerun log: `/tmp/ci-2425-ai-merch-targeted.log` (7/7 passed with `--retries=0`)

## Implementation Plan

### Phase 1: Root-Cause Requested Failures

1. Fix deal custom-field update persistence so `customFields` wrapper values are stored on update and visible through the detail endpoint.
2. Fix the CRM company clean-save optimistic-lock test path so the form submit produces the intended PUT and asserts the real conflict-bar behavior.

### Phase 2: Verification

1. Run targeted integration specs for the changed areas with retries disabled.
2. Run the relevant unit/type checks for changed packages.
3. Run two independent full ephemeral integration runs.

### Phase 3: PR

1. Open a stabilization PR against `develop`.
2. Apply labels and summary comments per repo workflow.

## Risks

- Full ephemeral runs are long-running and may expose unrelated standalone or shard-level failures. If unrelated, split them into separate stabilization PRs.
- PR #2425 CI may still be in progress while fixes are prepared against `develop`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Root-Cause Requested Failures

- [x] 1.1 Fix deal custom-field update persistence — afd6a28e4
- [x] 1.2 Fix CRM company clean-save optimistic-lock flow — afd6a28e4

### Phase 2: Verification

- [x] 2.1 Run targeted integration specs — afd6a28e4
- [x] 2.2 Run relevant unit/type checks — afd6a28e4
- [x] 2.3 Stabilize catalog AI sheet integration flake — pending commit
- [ ] 2.4 Run two independent full ephemeral integration runs

### Phase 3: PR

- [x] 3.1 Open stabilization PR against develop — 2606
- [ ] 3.2 Apply PR labels and summary comment
