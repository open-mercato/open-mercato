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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose current failures

- [ ] 1.1 Collect the current `main` workflow/job failures and their failed-step logs.
- [ ] 1.2 Classify each failure and reproduce actionable defects with the closest local command.

### Phase 2: Correct root causes

- [ ] 2.1 Implement minimal fixes with regression coverage for every actionable failure.
- [ ] 2.2 Run targeted validation and confirm the original failure signatures are resolved.

### Phase 3: Verify and hand off

- [ ] 3.1 Run the repository's full configured validation gate and push the completed fix set.
- [ ] 3.2 Confirm pull-request CI reaches green and obtain an independent final review verdict.
