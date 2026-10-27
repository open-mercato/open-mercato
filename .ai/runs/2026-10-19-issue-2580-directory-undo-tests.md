# Directory undo integration coverage

Goal: automate #2580's directory undo/redo invariants and non-undoable tenant mutations with isolated fixtures.

Source doc: .ai/specs/2026-10-19-directory-undo-integration-coverage.md (design PR #7660)

## Scope

Add the directory TC-UNDO-001 suite using existing helpers, metadata, and disable flag. Preserve production behavior. Quarantine observed lifecycle defects with a tracked issue; keep other assertions active.

## Implementation Plan

### Phase 1: API integration coverage

1.1 Verify live organization/action/custom-field contracts and track lifecycle defects.
1.2 Implement create/update/delete round trips, full snapshots, hierarchy/custom fields, token consumption, null-scope regression, and tenant no-token assertions.

### Phase 2: Verification

2.1 Prove enabled/disabled runs and execute the configured local validation gate.
2.2 Independently review, address findings, and publish evidence with the ready PR.

## Risks

Create undo currently hard-deletes and redo resets creation time; lifecycle assertions are quarantined with #7663. All SQL observations must target ephemeral DATABASE_URL and fixture tenant/id. Existing unrelated worktree changes are excluded from commits. Runner: local; compose probes failed interpolation because JWT_SECRET was unset, and no configured running app was established.

## Evidence so far

Both package builds, generation, i18n sync/usage, workspace/core typechecking, application build, and template parity passed. The final live suite passed four active cases with two lifecycle quarantines; the disable flag skipped all six. Temporarily enabling the quarantines reproduced physical row removal and changed creation time, and the exact committed file was restored. Bounded implementation feedback led to persisted-state, active-state, and custom-field fixture corrections; this feedback does not complete the authoritative PR review.

The full `yarn test` gate failed in `create-mercato-app`: macOS sandbox policy blocks Homebrew's `libuv.1.dylib`, and tracker-copy equality sees pre-existing local tracker modifications. Core passed 2,376 suites / 22,739 tests; 47 of 48 workspace tasks succeeded. The failing harness/tracker files are outside this PR. These local environment diagnostics establish neither a changed-code defect nor a failed current-head CI check. Under the repository's CI-first review policy, pending CI is reported as incomplete evidence without running local substitutes or requesting changes.

Current verification (2026-10-25): GitHub checks passed for `83eb7f7ef02a5cad7dd0440416f504cd9248affc`, including lint, ds-lint, unit tests, documents-multi-instance, ephemeral integration, Enterprise Contribution Guard, mutation scope, and license/cla. The integration job reports 57 passed / 2 skipped, including the directory suite. Validation source: GitHub checks; the CI-first policy does not require repeating these gates locally for this documentation-only correction. The required-check endpoint is not readable by the integration, so all reported checks are treated as required.

Review remediation (2026-10-25): the independent review requested removal of the unrelated `publish-ready-prs-under-maintainer-no-drafts-policy` lesson and catalog entry. Both are removed; the catalog count is restored. The test suite is unchanged. Keep `Status: in-progress` until the original reviewer completes re-review of the correction. Merge design PR #7660 before this PR so the source-document link resolves. No approval, QA sign-off, or merge is implied by publication.

## Progress

PR: #7662

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API integration coverage

- [x] 1.1 Verify live contracts and track lifecycle defects — #7663; enabled API run at 2026-10-19T13:50:52Z
- [x] 1.2 Implement directory undo integration suite — f4e1be7655

### Phase 2: Verification

- [x] 2.1 Prove enabled/disabled runs and validation gate — 83eb7f7ef0; enabled/disabled runs recorded above; GitHub CI passed (run 39300726705)
- [ ] 2.2 Independently review and publish evidence — independent review 5643552379 requested removal of the unrelated lesson; correction published for re-review; current-head CI will be reported separately
