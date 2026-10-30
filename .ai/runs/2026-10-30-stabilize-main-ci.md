# Stabilize main CI

## Goal

Restore the current `main` branch workflows to green by identifying each failing check from its logs, fixing the underlying repository defect, and proving the fixes on a pull request.

## Scope

- Inspect the newest workflow runs for the current `main` head and classify failures as code, test, flake, or infrastructure.
- Reproduce actionable failures locally and make the smallest repository change that corrects the root cause.
- Add or update regression coverage for changed behavior and run the configured validation gate.
- Open and maintain a draft pull request until the implementation, CI evidence, and independent review are complete.

## Non-goals

- Do not weaken, skip, or remove tests or CI checks.
- Do not refactor unrelated code or change product behavior beyond the demonstrated failure.
- Do not apply database migrations locally or change release policy.

## Implementation Plan

### Phase 1: Diagnose current failures

1. Collect the current `main` workflow/job failures and their failed-step logs.
2. Classify each failure and reproduce actionable defects with the closest local command.

### Phase 2: Correct root causes

1. Implement minimal fixes with regression coverage for every actionable failure.
2. Run targeted validation and confirm the original failure signatures are resolved.

### Phase 3: Verify and hand off

1. Run the repository's full configured validation gate and push the completed fix set.
2. Confirm pull-request CI reaches green and obtain an independent final review verdict.

## Risks

- Release workflows may depend on external package registries or credentials; failures proved to be external infrastructure will be documented rather than masked in code.
- Other commits may land on `main` during the run; diagnosis is pinned to the recorded head SHA and the pull request is rebased only through normal merge commits if needed.

## Diagnosis

- `main` SHA `440f7c2b4cdcb69d820423ecbb9db71e4a8494f9` failed [Develop Snapshot Release run 41132875987](https://github.com/open-mercato/open-mercato/actions/runs/41132875987) only in `Release snapshot`.
- `@open-mercato/channel-fcm` and `@open-mercato/events` each failed with npm `TLOG_CREATE_ENTRY_ERROR`: Rekor returned HTTP 409 because an equivalent transparency-log entry already existed. Their snapshot versions remained absent from npm, while every other package published.
- This is the Sigstore retry-after-success defect fixed upstream in [sigstore-js#1709](https://github.com/sigstore/sigstore-js/pull/1709): the transparency entry is committed, a retry receives the valid duplicate, and the current client treats that duplicate as fatal. The fix merged on 2026-10-27 but is not present in the published Sigstore version used by npm in the workflow.
- The smallest repository safeguard is a bounded wrapper that retries only this exact two-part error signature, preserves `--provenance`, and fails immediately for all other npm errors. The caller also verifies registry state after a client failure so a completed publish is not falsely reported as failed.
- The snapshot's standalone-app follow-up also exposed a deterministic activation defect: `scripts/lib/module-activation-fixtures.ts` still injected the removed `exampleCalendarOverrides` symbol, so evaluating the generated `src/modules.ts` failed with `ReferenceError`. The fixture now relies on the example module's own calendar registration and its test bundles and evaluates every activated module configuration instead of checking generated structure alone.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose current failures

- [x] 1.1 Collect the current `main` workflow/job failures and their failed-step logs. — e6735b1e59
- [x] 1.2 Classify each failure and reproduce actionable defects with the closest local command. — e6735b1e59

### Phase 2: Correct root causes

- [x] 2.1 Implement minimal fixes with regression coverage for every actionable failure. — 4c20fce5cc, 343ebfffcd
- [x] 2.2 Run targeted validation and confirm the original failure signatures are resolved. — 4c20fce5cc, 343ebfffcd

### Phase 3: Verify and hand off

- [ ] 3.1 Run the repository's full configured validation gate and push the completed fix set.
- [ ] 3.2 Confirm pull-request CI reaches green and obtain an independent final review verdict.
