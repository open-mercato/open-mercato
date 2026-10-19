# Resources undo integration coverage — #2577

## Goal and Scope

Automate resources TC-UNDO-001 lifecycle, scalar/custom-field restoration, relations, tag membership, consumed tokens, and the existing disable flag. Production fixes and schema changes are outside this test-only task; reproducible defects require linked, narrow quarantines.

Source doc: .ai/specs/2026-10-19-resources-undo-integration.md
Source spec PR: https://github.com/open-mercato/open-mercato/pull/7657

Engine: om-auto-create-pr (steps: 4, --loop: no)

## Implementation Plan

### Phase 1: Coverage

1. Add resource-type, activity, and comment lifecycle coverage with focused shared fixture assertions.
2. Add resource lifecycle, custom-field, related-collection, tag membership, and non-undoable tag CRUD coverage.

### Phase 2: Verification

3. Prove enabled execution and disabled skips in the managed ephemeral environment; link and narrowly quarantine confirmed defects.
4. Run the configured validation gate and independent PR review, then publish the final evidence.

## Risks

Child-row removal and activity date serialization may reveal existing command defects. Tests must distinguish these from test fixture mistakes and must never read a developer database accidentally. All queries scope fixture IDs to the authenticated tenant and organization.

## Progress

PR: #7659

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Coverage

- [x] 1.1 Add resource-type, activity, and comment lifecycle coverage. — 49eedb8c37
- [x] 1.2 Add resource, custom-field, relation, and tag coverage. — 5a60b3906e

### Phase 2: Verification

- [x] 2.1 Verify enabled execution and disabled skips; track confirmed defects. — cc71346547
- [ ] 2.2 Complete validation and independent review; publish evidence.

## Verification Notes

- Runner: local, with the repository-managed isolated app/database. The linked worktree's unrelated untracked WMS migration duplicates existing columns, so validation uses a clean temporary source snapshot. Resource command sources match this branch; GitHub checks remain authoritative for the exact published head.
- Initial enabled run: 20 cases, 14 passed and 6 failed. Both attempts reproduced comment/activity creation timestamp loss and physical row deletion during create undo. Follow-ups: #7666 (creation timestamps) and #7667 (soft deletion).
- Keep normal child lifecycle/scalar/date/same-ID checks active. Only four isolated timestamp cases and two I3 row-retention cases are quarantined with linked `test.fixme` calls.
- Final enabled run: 18 passed, 6 narrowly quarantined; disabled run: all 24 skipped before authentication. The existing disable-flag harness passed all 14 unit tests. Package builds, generation, translation sync/usage, workspace typechecking, and application build passed in the clean snapshot.
- Full-gate blocker: workspace unit runs fail when unrelated Jest workers terminate with SIGSEGV in varying CLI/core suites. Two core suites passed an isolated retry (29 tests), and both affected CLI suites passed in isolation (23 tests). Homebrew Node also fails the create-app sandbox because its libuv library is outside the sandbox read roots; standalone Node 24.18 and bundled Node 24.19 pass the isolated sandbox case, but full runs still encounter worker crashes. No test or production configuration was weakened.
- Keep PR #7659 as a draft with Status: in-progress until the full validation gate is green. Linux CI for the published code head is queued. Resume with `om-auto-continue-pr 7659` when usable CI evidence or a stable full-test runner is available. The run releases its claims and does not schedule an unattended follow-up.
