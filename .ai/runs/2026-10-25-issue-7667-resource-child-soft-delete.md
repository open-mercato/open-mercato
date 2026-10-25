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

- [ ] 2.1 Merge current main and preserve timestamp restoration with row revival.
- [ ] 2.2 Reject hidden-row ordinary update/delete with regression coverage and correct the spec base reference.
- [ ] 2.3 Validate focused tests, lessons catalog and compiler/lint, review the combined diff, publish and request re-review.
