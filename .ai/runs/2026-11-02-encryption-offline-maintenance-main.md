# Encryption maintenance review follow-up on main

## Goal

Apply the reviewed encryption-maintenance safety fixes on main, aligned with the release backport and the operator-approved offline maintenance contract.

## Scope

Require tenant-confirmed offline maintenance before retiring encryption maps, preserve concurrent writes through conditional updates, prove complete governed-scope coverage before retirement, and retain a conspicuous compatibility bridge for previous root secrets supplied through argv. Preserve main's custom-entity document rotation and existing encryption hardening.

Source doc: `.ai/specs/implemented/SPEC-031-2026-02-18-decrypt-database-cli.md`

## Implementation Plan

1. Compare the release review repair with current main and adapt only missing fixes.
2. Preserve custom-document support and add focused regression/integration coverage.
3. Align CLI/operator documentation and the existing specification with the offline contract.
4. Execute the configured validation gate and review the resulting diff.
5. Publish the completed PR with validation evidence and independent review.

## Risks

The full local validation gate is blocked by repeated native Jest worker SIGSEGVs under CI-exact Node 24.19.0; keep the PR draft until a supported-environment rerun completes.

Offline confirmation is an operator acknowledgment, not a mechanism that stops external writers. Operators must stop every writer before map retirement and restart all replicas before resuming. Do not claim online coordination of previously queued encrypted payloads. Keep the argv compatibility bridge explicit and document the exposure.

## Validation evidence and remaining work

Local runner: pinned Yarn 4.17.1 with a full worktree-local install, initially Node 24.22.2 and then CI-exact Node 24.19.0. Package builds, generation, translation sync/usage, all workspace typechecks, and the production app build passed. Final core build/typecheck and lessons validation passed after the last source correction. The repaired source passes 83 focused tests (including main custom-document support) and eight real PostgreSQL scenarios in a disposable database; its container was stopped after testing. Independent code review verified the hash snapshot and bounded final-scan corrections at `66789e02f` without another source finding.

Initial Node 24.22.2 full runs failed a docs worker 1 GiB heap limit and create-app sandbox package reads. CI-exact Node 24.19.0 eliminated those failures: docs passed all 24 tests at the configured heap and writable-harness execution proceeded. That run exposed actual omissions repaired in `90e824a46` (explicit table-sort comparator and the existing system-scope fixture's unsafe-key acknowledgment). Four regression suites passed 42 tests. The new compatibility summary exceeded a fixed standalone context budget; `7fb10f417` shortened the summary while retaining safety flags and linking complete migration guidance. All six budget checks passed without changing caps or tests. The complete create-app package then passed on Node 24.19.0: 996 passed, six skipped, zero failed.

Repeated literal configured `yarn test` runs under Node 24.19.0 then failed native Jest workers with SIGSEGV in different unrelated suites. A full-scope concurrency-one run also hit SIGSEGV, so this is not resolved by workspace scheduling. Crashed core and shared suites passed isolated in-band rechecks (42, eight and four tests); no assertion, harness permission or cap was weakened. The literal full test gate has not passed and must not be reported green.

Keep this PR draft and `Status: in-progress` until the complete configured gate can run successfully in a supported environment, then complete independent review and manual QA before merge. Steps 2.1 and 2.2 remain pending.


## Progress

PR: #8488

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Adapt reviewed maintenance changes

- [x] 1.1 Compare and adapt the release safety repair to main. — 56dd6dcca
- [x] 1.2 Preserve custom documents and add focused coverage. — 56dd6dcca
- [x] 1.3 Update operator documentation and specification. — 56dd6dcca

### Phase 2: Verify and publish

- [ ] 2.1 Run validation and inspect the final diff.
- [ ] 2.2 Publish the completed PR and independent review evidence.
