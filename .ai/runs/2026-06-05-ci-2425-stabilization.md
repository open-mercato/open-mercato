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
- PR #2606 CI run `27023888378`, job `79760208071`: `ephemeral-integration (8/15)` still failed `TC-CRM-CF-MULTI-EDIT-001` with updated multi-select values reading back as `[]`.
- Manual catalog reproduction on fresh app `http://127.0.0.1:45643`: first product multi-select PUT read back values, second PUT left zero `custom_field_values` rows for the field, proving the defect was the shared EAV array replacement write, not the catalog route or query-index read path.
- Custom-field targeted rerun log after shared EAV replacement fix: `/tmp/ci-2425-cf-multi-targeted.log` (3/3 passed with `--retries=0`: catalog product multi-select, CRM deal multi-select, CRM legacy bare-key negative contract).
- Full ephemeral proof run 1 log: `/tmp/ci-2425-full-ephemeral-run-1-after-eav.log` on app `http://127.0.0.1:46227`, DB `localhost:32865`, `--retries=0`: 1421 passed, 70 skipped, 0 failed in 20.9m. Included in-suite passes for `TC-CAT-CF-MULTI-EDIT-001`, `TC-CRM-CF-MULTI-EDIT-001`, `TC-LOCK-OSS-014`, and catalog AI sheet specs.
- Full ephemeral proof run 2 attempt log: `/tmp/ci-2425-full-ephemeral-run-2-after-eav.log` on app `http://127.0.0.1:45155`, DB `localhost:32866`, invalid/not counted: `TC-AUTH-003` and `TC-AUTH-007` exposed auth form hydration races where the first filled field was reset before submit, so no valid login/reset POST could complete.
- Auth hydration targeted rerun log after reset form readiness marker: `/tmp/ci-2425-auth-targeted.log` (2/2 passed with `--retries=0`: `TC-AUTH-003`, `TC-AUTH-007`) on fresh app `http://127.0.0.1:45035`, DB `localhost:32868`.
- PR #2606 merged into `develop`; follow-up branch continues from merged `origin/develop` with only the remaining stabilization alignments.
- Diagnostic full ephemeral run after PR #2606 fixes: `/tmp/ci-2425-full-ephemeral-run-2-after-auth.log` on app `http://127.0.0.1:45819`, DB `localhost:32870`, invalid/not counted because it used a pre-follow-up app bundle. It ended with exactly 3 failures (`TC-INT-004`, `TC-LOCK-OSS-014` CRM-01, `TC-LOCK-OSS-015` stale person edit) and 1419 passed / 69 skipped. This run proved the merged fixes held for auth reset, multi-value custom fields, catalog AI sheet specs, and the other OSS lock suites.
- Follow-up targeted rerun log after `CrudForm` dirty-state and `TC-INT-004` login synchronization fixes: `/tmp/ci-2425-followup-targeted.log` (6 passed, 1 intentionally skipped, `--retries=0`) on fresh rebuilt app `http://127.0.0.1:45367`, DB `localhost:32872`.
- Follow-up full ephemeral proof run 1 log: `/tmp/ci-2425-followup-full-run-1.log` on app `http://127.0.0.1:45367`, DB `localhost:32872`, `--retries=0`: 1441 passed, 70 skipped, 0 failed in 21.4m. Covered `TC-INT-004`, `TC-CRM-CF-MULTI-EDIT-001`, `TC-LOCK-OSS-014`, `TC-LOCK-OSS-015`, currency lock specs, catalog AI sheet specs, and auth reset specs.
- Follow-up full ephemeral proof run 2 attempt log: `/tmp/ci-2425-followup-full-run-2.log` on app `http://127.0.0.1:44713`, DB `localhost:32873`, invalid/not counted: `TC-CUR-ATOMIC-VERIFY` hit the three-letter currency code namespace collision exposed by soft-delete-aware DB uniqueness. The run was stopped after the known failure was patched, so later connection errors are from the stopped app and are not counted.
- Currency fixture targeted rerun log after aligning remaining ad hoc currency code generators to the shared full-namespace allocator: `/tmp/ci-2425-followup-targeted-currency.log` (26 passed, 1 intentionally skipped, `--retries=0`) on fresh rebuilt app `http://127.0.0.1:46205`, DB `localhost:32875`.

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
- [x] 2.3 Stabilize catalog AI sheet integration flake — 0556a3127
- [x] 2.4 Stabilize shared EAV multi-value replacement after PR #2606 CI failure — 881d42dcc
- [x] 2.4a Stabilize auth form hydration interactions exposed by full proof run 2 — 92ebbb417
- [x] 2.4b Stabilize late `CrudForm` initialValues refresh and raw login synchronization after diagnostic full run — feee7b679
- [x] 2.4c Stabilize currency integration fixtures against soft-delete-visible code uniqueness
- [ ] 2.5 Run two independent full ephemeral integration runs

### Phase 3: PR

- [x] 3.1 Open stabilization PR against develop — 2606
- [x] 3.2 Apply PR labels and summary comment — c03f44479
- [x] 3.3 Open follow-up stabilization PR after #2606 merge — 2613
