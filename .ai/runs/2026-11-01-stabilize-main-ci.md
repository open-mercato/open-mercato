# Stabilize main CI

## Goal

Restore every failing required CI check on `main` by identifying the current root cause, applying the smallest durable correction, and proving the fix on a pull request.

## Scope

- Inspect the latest `main` workflow and check-suite results, including failed-step logs.
- Change only the files responsible for reproducible CI failures and add focused regression coverage for any behavior change.
- Run the repository validation gate and confirm the pull request's required checks are green.

## Non-goals

- Refactor unrelated code or broaden the change beyond the failing CI surface.
- Re-run or modify successful workflows without evidence that they contribute to the failure.
- Merge the pull request or alter branch-protection, release, or QA policy.

## Implementation Plan

### Phase 1: Diagnose the failure

1. Identify the failing required checks on the latest `main` commit, reproduce them where practical, and document the root cause and affected project guidance.

### Phase 2: Correct the root cause

1. Implement the smallest durable fix with regression coverage and targeted validation, then remove any scope creep found in the diff.

### Phase 3: Prove readiness

1. Run the full configured validation gate, obtain an independent final review, and confirm all required pull-request checks are green.

## Risks

- CI may expose multiple independent failures; each will be fixed only when supported by a failing log or local reproduction.
- Environment or infrastructure failures will be distinguished from repository defects before code is changed.
- The final GitHub checks can outlast local validation; the run remains in progress until required checks finish green or a concrete external blocker is recorded.

## Diagnosis

- Latest affected `main` commit: `a3763359b83d5d2d38a5baf1424b2c91fc68c4b1`.
- Failing checks: `ds-lint`, `lint`, `prepare`, the default-branch `audit`, and snapshot publishing all stop during `yarn install --immutable`; downstream skips are consequences of that blocker.
- Root cause: the nodemailer workspace metadata for `@open-mercato/channel-ses` and `@open-mercato/channel-smtp` was crossed in `yarn.lock`. Their manifests declare `^10.1.4` and `^10.0.10` respectively, while the lockfile records the inverse.
- Classification: deterministic repository defect. The same `YN0028` failure reproduced locally; this is not a flake or runner outage.
- Minimal correction: regenerate `yarn.lock` from the unchanged workspace manifests and prove the generated result with `yarn install --immutable` before the full gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose the failure

- [ ] 1.1 Identify the failing required checks on the latest `main` commit, reproduce them where practical, and document the root cause and affected project guidance.

### Phase 2: Correct the root cause

- [ ] 2.1 Implement the smallest durable fix with regression coverage and targeted validation, then remove any scope creep found in the diff.

### Phase 3: Prove readiness

- [ ] 3.1 Run the full configured validation gate, obtain an independent final review, and confirm all required pull-request checks are green.
