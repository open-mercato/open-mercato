# Execution plan — resource child retention review corrections (adopted from PR #7714)

**Origin:** adopted by `om-auto-continue-pr` on 2026-10-25 because PR #7714 carried no execution plan.
**PR:** #7714 · **Branch:** `fix/issue-7667-resource-child-soft-delete` · **Base:** `main`
**Author:** @haxiorz

## Goal

Retain resource children across create undo/redo while ordinary update/delete commands return 404 for hidden rows.

## Scope

Resource comment/activity command lookups, regression coverage, and the existing retention spec. Reconcile the timestamp restoration already merged in #7715.

## Non-goals

No changes to public routes, schemas, dependencies, ordinary visible-row deletion, QA approval, or merge policy.

## Evidence

| Conclusion | Drawn from | Confidence |
| --- | --- | --- |
| Retain rows and restore the same ID | #7667 and the existing retention spec | high |
| Reject hidden-row update/delete while preserving replay access | @wojciechszyjka review 5643513575 and comment 6398478018 | high |
| Preserve both timestamp restoration and row revival | Merged #7715, commit 90cf88a2a | high |

## Assumptions

The four execute lookups can be narrowed independently of snapshot/replay helpers. Current-head CI remains the full validation authority; focused red/green coverage validates the requested correction locally.

## Risks

Filtering a shared replay lookup could break restoration. Tests must cover both hidden-row rejection and successful redo.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Retain resource children on create undo with migration and lifecycle coverage — 6fc7741ab

### Phase 2: Review corrections

- [x] 2.1 Merge current main and preserve timestamp restoration with row revival. — 97b854dcc
- [x] 2.2 Reject hidden-row ordinary update/delete with regression coverage and correct the spec base reference. — 8cb19b284
- [x] 2.3 Validate focused tests, lessons catalog and compiler/lint, review the combined diff, publish and request re-review. — 8cb19b284

## Validation evidence

Runner: local (no running app container). The four new hidden-row command cases failed before the lookup filters, then all 56 focused retention/timestamp cases passed. All 13 resources suites passed (99 tests). A task-only TypeScript project compiled both changed commands and both regression files with the real compiler and this checkout's source mappings. Targeted ESLint passed with only the repository's advisory missing-pages-directory message. Post-merge lesson structural tests passed (5 tests), the lesson catalog validator passed after the lesson update, and whitespace checks passed.

The `om-auto-review-pr --autofix` source pass found no additional actionable findings. The four ordinary execute lookups alone filter visibility; retained-row snapshot/replay lookups remain available and scoped. Historical recreation restores `createdAt` from #7715 and retained rows preserve their creation time while clearing `deletedAt`. This resume adds no contract or schema changes. Current-head GitHub checks and independent review/QA remain merge gates; the original head's green checks are historical evidence only. Publication, final remote SHA, reviewer request and lock release are recorded in the PR resume summary.
