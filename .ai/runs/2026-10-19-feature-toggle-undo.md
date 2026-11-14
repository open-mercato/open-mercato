# Feature-toggle undo integration coverage

Goal: automate issue #2581's global and tenant-override undo/redo invariants through the real API.

Status: complete (author review remediation; maintainer re-review remains pending).

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
- Internal agent check: one partial JSON assertion was corrected; re-checks found no remaining code findings. This is historical author-side verification, not formal GitHub approval.
- The disposable environment was stopped after enabled/disabled validation. GitHub checks for code head `65db20165b46f5235c4d49109ed48d27266f61ce` passed: lint, ds-lint, test, documents-multi-instance, ephemeral integration, the enterprise contribution guard, and license/cla. The [CI integration job](https://github.com/open-mercato/open-mercato/actions/runs/39300563404/job/118227289378) passed 37 cases with 2 skipped, including 12 passing feature-toggle undo cases and the 2 linked quarantines. The local full-suite failure above is retained as historical environment evidence.

## Workflow audit — 2026-10-19

- The initial run mixed companion skills from the explicitly invoked collection with a different global installation. This audit follows the invoked collection and repository overrides.
- The only GitHub review record was the author's `COMMENTED` validation note. Its `REVISE` heading and the resulting `changes-requested` label were incorrect; the note is corrected and the PR returns to `review`.
- A fresh read-only audit found no actionable code findings. Existing passing local evidence is retained; running GitHub checks are not treated as failures or replaced with another broad local gate.

## Review remediation — 2026-10-25

- [Review by @wojciechszyjka](https://github.com/open-mercato/open-mercato/pull/7661#pullrequestreview-5643560804): removed the unrelated `respect-explicit-pr-publication-state` lesson and restored the lessons catalog to its prior content. No workflow policy is proposed in this test PR.
- Refreshed the completed validation evidence and author-work status. Follow-up changes are documentation-only; executable tests and helpers remain byte-for-byte unchanged from the passing code head above. Checks for the follow-up head are reported separately on the PR.
- The optional shared consumed-token helper consolidation is deferred to a separate harness change so this review fix preserves the existing shared contract and strict local assertions.
- Source spec PR #7658 merged on 2026-10-25 as `6091ec4dd09d4733e5e16ce2c70de2ff6959f9e0`, satisfying the review's merge-order note. The two runtime defects remain tracked by #7664 and #7665.
- Validation source: GitHub checks for the unchanged code, plus local `node packages/create-app/agentic/shared/scripts/check-lessons.mjs --root .` and `git diff --check` for this documentation-only correction. The author re-review found no new actionable findings; maintainer re-review is requested separately and is not replaced by author approval.

## Progress

PR: #7661

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Test coverage

- [x] 1.1 Add global CRUD undo/redo, scalar/version, related-override and permission coverage. — 489dd432a1
- [x] 1.2 Add override lifecycle, token consumption and identity coverage. — 489dd432a1

### Phase 2: Validation and review

- [x] 2.1 Run enabled/disabled integration tests and the configured validation gate (runner: local). — 65db20165b (historical local evidence above; completed CI evidence under the repository's CI-first review override)
- [x] 2.2 Independently review, fix findings, and publish the final PR state with validation evidence. — 9a3febd525

### Phase 3: Review remediation

- [x] 3.1 Remove the unrelated publication-state lesson and its catalog entry. — 503b4f23e
