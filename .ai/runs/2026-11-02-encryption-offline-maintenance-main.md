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

The full local validation gate is blocked by a docs-worker heap exhaustion and a create-app execution-sandbox package-config permission failure; keep the PR draft until a supported-environment rerun completes.

Offline confirmation is an operator acknowledgment, not a mechanism that stops external writers. Operators must stop every writer before map retirement and restart all replicas before resuming. Do not claim online coordination of previously queued encrypted payloads. Keep the argv compatibility bridge explicit and document the exposure.

## Validation evidence and remaining work

Local runner: Node 24.22.2 and pinned Yarn 4.17.1, with a full worktree-local install. Package builds, generation, translation sync/usage, all workspace typechecks, and the production app build passed. The repaired source passes 83 focused tests (including main custom-document support) and eight real PostgreSQL scenarios in a disposable database; its container was stopped after testing. Independent code review verified the hash snapshot and bounded final-scan corrections at `66789e02f` without another source finding.

The configured literal `yarn test` did not pass: the docs worker exhausted its script-configured 1 GiB heap. The docs workspace passed all 24 tests with a 4 GiB heap. A rerun of the complete Turbo test scope with the same assertions and a 4 GiB heap completed 49 of 51 tasks successfully, then failed create-app writable-harness tests because Node could not read a fixture package configuration under the local execution sandbox (`ERR_INVALID_PACKAGE_CONFIG`, operation not permitted), before the behavior oracles could execute. No harness permissions or assertions were weakened. This is incomplete full-gate evidence, not a passing test gate.

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
