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

- [ ] 2.1 Merge current main and reconcile both command regression suites and scenario identifiers
- [ ] 2.2 Verify command behavior, compiler/lint, and merged lesson catalog; review the final diff
- [ ] 2.3 Publish the fix, record evidence, request human re-review, and release the claim
