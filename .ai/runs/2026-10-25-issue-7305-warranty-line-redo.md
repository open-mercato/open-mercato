# Execution plan — receiving and quarantine release redo (adopted from PR #7357)

**Origin:** adopted by `om-auto-continue-pr --adopt auto` on 2026-10-25 because the PR had no tracking plan.
**PR:** #7357 · **Branch:** `fix/issue-7305-warranty-line-redo` · **Base:** `main`
**Author:** @haxiorz

## Goal
Preserve receiving, quarantine release, and assessment redo after undo while honoring current request headers, tenant scope, parent status, and normal-write optimistic locks.

## Scope
Merge current main and reconcile command test imports and appended regressions; preserve both this PR's redo suite and main's undo-conflict suite from #7296. Give the receiving redo integration scenario a distinct number after main's portal-upload coverage.

## Non-goals
No API, database, lifecycle, permission, design-system, or workflow changes. Do not merge other open PRs or claim prior combined-build QA as verification of this branch.

## Evidence
| Conclusion | Source | Confidence |
| --- | --- | --- |
| Redo must discard expired persisted body versions and honor current headers | PR description and existing command hooks/tests | High |
| Preserve both appended regression suites while resolving the merge | Review 5564664417 and QA comment 6202103220 | High |
| Main is the current target | Live PR base and freshly fetched origin/main | High |

## Assumptions
The inherited conflict is the only confirmed outstanding source finding. Existing QA and labels remain pending human reassessment. Current-head CI is authoritative; local verification will be narrowly scoped to missing post-merge evidence.

## Risks
An incorrect merge could drop redo coverage, undo state/version guards, or main's refusal to recreate physically missing rows. Targeted command tests and diff inspection cover these paths. Live API verification requires an app running this checkout.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed

- [x] 1.1 Add guarded redo hooks, command regressions, isolated API fixtures, and scenario budgets — d136c3558

### Phase 2: Review remediation

- [x] 2.1 Merge current main and reconcile both command regression suites and scenario identifiers — eb0030eec
- [x] 2.2 Verify command behavior, compiler/lint, and merged lesson catalog; review the final diff — eb0030eec
- [x] 2.3 Publish the fix, record evidence, request human re-review, and release the claim — bee4b6a12

## Verification

Runner: local. Docker compose app probes were unavailable. Validation source: local fallback for the merged source, followed by exact-head GitHub checks after publication.

- Reconciled `claim-commands.test.ts`: 101 tests passed. Incoming main undo suite preserved byte-for-byte after newline normalization; redo fixtures now supply the required captured after snapshot.
- Warranty suite with read-only dependency overlays and existing generated helper dependencies: 63 suites / 737 tests passed, excluding the unchanged `quantity.test.ts` suite. The first broad run exposed missing local test dependencies/generated helpers; those were repaired only in task-owned runtime setup. Quantity has two decimal-format assertions that expect an English locale but receive Polish separators on this Windows host; both source and test are identical to main, and this limitation remains disclosed.
- Actual strict TypeScript 6.0.3 options/syntactic/semantic diagnostics passed for the changed `commands/claim-lines.ts` file, using app compiler options and the existing generated entity-ID type dependency read-only. Full workspace typecheck remains CI-owned.
- ESLint passed for all eight changed TypeScript files; it emitted the existing pages-directory configuration warning.
- Lesson catalog structural tests: 5 passed. `git diff --check` passed.
- Task-local Playwright discovery found both `TC-WC-039` redo scenarios. Repository-wide discovery produced no output before interruption. No app or ephemeral-environment descriptor exists for this checkout; live API scenarios and provider-dependent assessment were not rerun here. Prior combined-build QA is historical evidence only.
- Source review found no remaining actionable change-local findings. The production diff against main remains three redo hooks. Current request headers, normal-write locks, tenant/organization scope, parent status, atomic flush, side effects, and main's missing-row undo refusal remain intact. No contract changes.
## Publication and human handoff

The source merge and validation record were published on the existing branch at `bee4b6a12`. Source review: https://github.com/open-mercato/open-mercato/pull/7357#pullrequestreview-5644641043. Comprehensive summary: https://github.com/open-mercato/open-mercato/pull/7357#issuecomment-6401451756. Human re-review was requested from Kapsik89, whose inherited feedback requested preservation of both regression suites. Existing changes-requested, QA, priority, and risk states are preserved pending reassessment; no merge or QA approval is claimed. The temporary claim is released during final tracker cleanup. Full current-head CI remains an external gate.