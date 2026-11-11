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
- The smallest repository safeguard is a bounded wrapper that retries only this exact two-part error signature, preserves `--provenance`, and fails immediately for all other npm errors. Exhausted retries remain fatal; registry presence alone is never accepted after a failed provenance client, preserving the supply-chain boundary identified by the PR security scan.
- The snapshot's standalone-app follow-up also exposed a deterministic activation defect: `scripts/lib/module-activation-fixtures.ts` still injected the removed `exampleCalendarOverrides` symbol, so evaluating the generated `src/modules.ts` failed with `ReferenceError`. The fixture now relies on the example module's own calendar registration and its test bundles and evaluates every activated module configuration instead of checking generated structure alone.
- Snapshot attempt 2 proved npm can accept a large package while keeping its metadata unavailable long after the workflow's five-minute ceiling: registry timestamps place `@open-mercato/core` visibility 20 minutes 24 seconds after successful publish acceptance. Both snapshot workflows now share one global, wall-clock-bounded forty-five-minute metadata deadline and retain a hard failure when npm never exposes the version.
- Main CI shard 5 exposed a test race in `TC-CHANNEL-API-009`: login opened the DOM-event SSE connection before the test installed its abort route, so the direct API deletion refreshed the reaction bar and removed the intended stale click target. Installing the route before login makes the localized-refusal scenario deterministic.
- Main CI shard 14 exposed an undersized default timeout in the API-heavy `TC-DOCUMENTS-010` flow. Both attempts exhausted the 20-second test budget while making normal successful fixture calls; the same scenario completed in 5.6 seconds on the prior green run and 5.7 seconds locally. Marking this established multi-module flow slow gives it the same CI-load budget used by comparable documents scenarios without weakening any assertion.

## Progress

PR: #8294

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose current failures

- [x] 1.1 Collect the current `main` workflow/job failures and their failed-step logs. — e6735b1e59
- [x] 1.2 Classify each failure and reproduce actionable defects with the closest local command. — e6735b1e59

### Phase 2: Correct root causes

- [x] 2.1 Implement minimal fixes with regression coverage for every actionable failure. — 4c20fce5cc, 343ebfffcd, d4f8e125c2, e03e45454f, 7759f12594, 5fc3d149a3, 605f7abb9b
- [x] 2.2 Run targeted validation and confirm the original failure signatures are resolved. — 4c20fce5cc, 343ebfffcd, d4f8e125c2, e03e45454f, 7759f12594, 5fc3d149a3, 605f7abb9b

### Phase 3: Verify and hand off

- [x] 3.1 Run the repository's full configured validation gate and push the completed fix set. — 523653d278, 5fc3d149a3, 605f7abb9b
- [x] 3.2 Confirm pull-request CI reaches green and obtain an independent final review verdict. — 605f7abb9b
