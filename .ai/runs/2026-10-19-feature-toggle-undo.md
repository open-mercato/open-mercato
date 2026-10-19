# Feature-toggle undo integration coverage

Goal: automate issue #2581's global and tenant-override undo/redo invariants through the real API.

Source doc: .ai/specs/2026-10-19-feature-toggle-undo-integration-coverage.md (spec PR #7658)

## Scope

Add module-local tests using the existing undo harness and disable gate. Preserve production behavior, ACLs, schema and shared harness contracts. Record concrete runtime defects separately and quarantine only their affected invariants.

## Implementation Plan

### Phase 1: Test coverage

1.1 Add global CRUD undo/redo, scalar/version, related-override and permission coverage.
1.2 Add override lifecycle, token consumption and identity coverage.

### Phase 2: Validation and review

2.1 Run enabled/disabled integration tests and the configured validation gate (runner: local).
2.2 Independently review, fix findings, and publish the final PR state with validation evidence.

## Risks

- Global creation undo hard-deletes and override creation redo may change identity. Isolate each confirmed defect behind a linked fixme.
- Unrelated pre-existing worktree changes are excluded from every commit.
- The complete repository gate may expose unrelated baseline failures; retain exact commands and evidence.

## Verification

- Runner: local; no running compose app was found.
- Enabled: `OM_INTEGRATION_MODULES=feature_toggles yarn mercato test:integration TC-UNDO-001` — 12 passed, 2 focused fixmes (25.2 seconds).
- Disabled: same command with `OM_INTEGRATION_UNDO_TESTS_DISABLED=1` — all 14 skipped.
- Live probes confirmed #7664 (no retained row after create undo) and #7665 (changed override ID after redo).
- Passed: `yarn build:packages`, `yarn generate`, second `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn build:app`, and `yarn template:sync`.
- Blocked: `yarn test` exits 1 in the unrelated create-app harness suite. Its sandboxed child Node cannot load libuv; a tracker-mirroring assertion also detects pre-existing local descriptor edits. Core (22,739 tests), UI (2,662), CLI (2,075), and enterprise (2,005) passed.
- Internal agent check: one partial JSON assertion was corrected; re-checks found no remaining code findings. This is author-side verification, not formal GitHub approval or a changes-requested review.
- The disposable environment was stopped after enabled/disabled validation. PR #7661 is non-draft and in `review`, awaiting a reviewer decision. Current-head GitHub CI is the validation authority under the CI-first override; the local full-suite failure above remains an environment limitation.

## Workflow audit — 2026-10-19

- The initial run mixed companion skills from the explicitly invoked collection with a different global installation. This audit follows the invoked collection and repository overrides.
- The only GitHub review record was the author's `COMMENTED` validation note. Its `REVISE` heading and the resulting `changes-requested` label were incorrect; the note is corrected and the PR returns to `review`.
- A fresh read-only audit found no actionable code findings. Existing passing local evidence is retained; running GitHub checks are not treated as failures or replaced with another broad local gate.

## Progress

PR: #7661

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Test coverage

- [x] 1.1 Add global CRUD undo/redo, scalar/version, related-override and permission coverage. — 489dd432a1
- [x] 1.2 Add override lifecycle, token consumption and identity coverage. — 489dd432a1

### Phase 2: Validation and review

- [ ] 2.1 Run enabled/disabled integration tests and the configured validation gate (runner: local).
- [x] 2.2 Independently review, fix findings, and publish the final PR state with validation evidence. — 9a3febd525
