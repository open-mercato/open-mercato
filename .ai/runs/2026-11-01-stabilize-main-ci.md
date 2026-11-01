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

## Validation evidence

- Runner: local (no running Compose `app` container).
- `yarn install --immutable` passes after regenerating the lockfile.
- The configured package builds, generation, i18n checks, typecheck, and application build pass. The literal root `yarn test` command does not complete on this local cockpit: Turbo needs loose environment propagation to avoid an overlong nested `tsx` socket, then the docs build exits at the root script's hardcoded 1 GB Node heap cap. The complete test graph passes with Turbo loose environment propagation and a 2 GB Node heap (51/51 tasks); the hosted `test` job passes on the PR head.
- PR #8428 reports every non-conditional check successful, including `lint`, `ds-lint`, `prepare`, `audit`, `test`, `documents-multi-instance`, `core-timezone`, CodeQL, and CLA. Conditional `docker-build`, `ephemeral-integration`, and `merge-coverage` jobs are skipped by workflow scope.

## Independent review

- Final review task `102752e9-c76f-4904-a9ab-23d0238e435c` reviewed all six commits and both changed files. It confirmed the lockfile correction matches the unchanged manifests, preserves nodemailer 10.1.4 resolution, and introduces no security, compatibility, or scope regression.
- The reviewer requested correction of the earlier statement that the configured local `yarn test` command passed. This plan now records the actual local limitation and the passing equivalent/hosted evidence. Changing the repository validation command or its memory policy is outside this CI-repair scope and would alter pipeline automation; no such change was made.

## Diagnosis

- Latest affected `main` commit: `a3763359b83d5d2d38a5baf1424b2c91fc68c4b1`.
- Failing checks: `ds-lint`, `lint`, `prepare`, the default-branch `audit`, and snapshot publishing all stop during `yarn install --immutable`; downstream skips are consequences of that blocker.
- Root cause: the nodemailer workspace metadata for `@open-mercato/channel-ses` and `@open-mercato/channel-smtp` was crossed in `yarn.lock`. Their manifests declare `^10.1.4` and `^10.0.10` respectively, while the lockfile records the inverse.
- Classification: deterministic repository defect. The same `YN0028` failure reproduced locally; this is not a flake or runner outage.
- Minimal correction: regenerate `yarn.lock` from the unchanged workspace manifests and prove the generated result with `yarn install --immutable` before the full gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose the failure

- [x] 1.1 Identify the failing required checks on the latest `main` commit, reproduce them where practical, and document the root cause and affected project guidance. — 585f671ddb

### Phase 2: Correct the root cause

- [x] 2.1 Implement the smallest durable fix with regression coverage and targeted validation, then remove any scope creep found in the diff. — 36abf1d2a9

### Phase 3: Prove readiness

- [ ] 3.1 Run the full configured validation gate, obtain an independent final review, and confirm all required pull-request checks are green.
