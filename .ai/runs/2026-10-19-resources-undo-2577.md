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
- Original verified run: 18 passed, 6 narrowly quarantined; disabled run: all 24 skipped before authentication. The existing disable-flag harness passed all 14 unit tests. Package builds, generation, translation sync/usage, workspace typechecking, and application build passed in the clean snapshot.
- Historical local limitation: full workspace unit runs encountered unrelated Jest worker SIGSEGV crashes. Isolated core/CLI retries passed 52 tests. GitHub checks for the original published head `df4117f5dfed25adc7b0b00dde2ed21329f3f5af` subsequently succeeded or were explicitly skipped: https://github.com/open-mercato/open-mercato/actions/runs/39265456780. The CI unit/typecheck job uses affected-package scoping; `ephemeral-integration (none)` is not execution evidence for the resource suites.
- Follow-up source review found missing resource-type custom-field I4 coverage. The added case exercises exact values through create/update/delete undo and redo with consumed-token checks and definition cleanup. A second independent source review found no confirmed defect in that addition. Expanded managed run: 19 passed and six existing linked quarantines; the added resource-type custom-field case passed. The affected core package typecheck passed. The expanded disabled run skipped all 25 cases before authentication. Follow-up implementation commit: `e114548506`.
- Workflow correction: the earlier `changes-requested` label was applied before a GitHub review existed, and the later approving conversation comment was unsupported. That verdict is withdrawn. Keep PR #7659 non-draft in `review` with `Status: in-progress`; CI, publication readiness, and review verdicts are separate signals.
- Authoritative review remains incomplete: the local `om-auto-review-pr` override requires a schema-versioned result, separate policy, and shared deterministic renderer, but the installed ordinary `om-code-review` skill lacks those assets. This account is also the PR author and cannot self-approve; a conversation comment must not emulate that approval. Step 2.2 stays unchecked until a proper review handoff completes. Release temporary claims/assignees; do not schedule unattended follow-up.
