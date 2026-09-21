# Execution plan — mount declared extension hosts at their real runtime boundaries (adopted from PR #6077)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-09-21 because PR #6077 carried no execution plan.
**PR:** #6077 · **Branch:** `fix/405-extension-runtime` · **Base:** `develop`
**Author:** @wojciechszyjka — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Land the three runtime-gap fixes the PR already implements — `DataTable` component overrides resolved at the render boundary, after-interceptors run by the handwritten `GET /api/catalog/categories` handler, and the deal owner label resolved from the auth profile when the optional `staff` module is absent — in a state that is mergeable into `develop`, green on the full validation gate, and code-reviewed.

## Scope

- `packages/ui/src/backend/DataTable.tsx` — resolve the registered component handle before mounting.
- `packages/core/src/modules/catalog/api/categories/route.ts` — run after-interceptors on both response shapes.
- `packages/core/src/modules/customers/lib/assignableStaff.ts` + `backend/customers/deals/page.tsx` — profile-based owner-name fallback.
- Regression tests for all three, plus the `.ai/lessons` record the PR adds.
- Bringing the branch up to date with `develop` and driving it through the pipeline's gate and review.

## Non-goals

- No ACL/permission changes and no migrations — the PR body records that the ACL hypothesis was checked separately and wildcard grants already authorize the app administrator.
- No broader refactor of the component-override or interceptor registries beyond the two call sites named above.
- No move of the `assignableStaff` test file to match its new `lib/` import target — a cosmetic follow-up, not this PR's goal.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is the three runtime-gap fixes stated above | PR #6077 body (Summary + Root cause sections, author-written) | high |
| The implementation is already complete and test-backed | diff `origin/develop...HEAD`: each of the three source changes ships an accompanying test (`DataTable.extensions.test.tsx`, `categories.route.test.ts`, `assignableStaff.test.ts`) | high |
| No permissions or migrations are in scope | PR body: "deliberately adds no permissions or migrations"; diff contains no migration or `acl.ts` file | high |
| The branch cannot merge as-is | `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`; `develop` is 89 commits ahead; trial merge conflicts only in `.ai/lessons.md` | high |
| No code review has happened | `gh pr view 6077 --json reviews` → `[]`; PR carries the `review` label but no submitted review | high |
| The change is user-facing | diff touches `packages/ui/src/backend/DataTable.tsx` and `customers/backend/customers/deals/page.tsx` — the `needs-qa` label already on the PR is correct and stays | high |
| CI was green on the pre-conflict head | `statusCheckRollup` for `415b5e93`: all `CI for Develop&Main` jobs SUCCESS/SKIPPED as of 2026-09-14 | high |

## Assumptions

- The `.ai/lessons.md` conflict is an index bookkeeping collision (catalog count 141→142 plus an inserted `umes` row) and resolves by keeping **both** sides' entries and recomputing the count. If that is wrong, the fix is a one-line edit to the catalog header.
- CI green on 2026-09-14 does not carry over across 89 base commits, so the full local gate is re-run rather than trusted.
- The PR's own validation list (focused suites only) is treated as evidence of author diligence, not as a substitute for the configured `validation.commands` gate.

## Risks

- `DataTable` is a very widely used host; wrapping its export in a registry-resolving component changes the mount path for every backend list in the app. Blast radius justifies the existing `risk-medium` label and the `needs-qa` gate.
- Merging 89 commits of `develop` may surface failures unrelated to the PR's own diff; those are triaged as base drift, not as PR defects.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Resolve registered `DataTable` transforms/wrappers/replacements at the render boundary, with a real-mount regression test — fe06a83f5
- [x] 1.2 Run after-interceptors in the handwritten `GET /api/catalog/categories` handler, with a route-level regression test — fe06a83f5
- [x] 1.3 Resolve the signed-in deal owner's label from the auth profile when the optional `staff` roster is disabled, with fallback and fail-soft tests — fe06a83f5
- [x] 1.4 Record the `.ai/lessons` entry for declared extension hosts needing real mount tests — 415b5e938

### Phase 2: Make the branch mergeable

- [ ] 2.1 Merge `origin/develop` into the PR branch and resolve the `.ai/lessons.md` catalog conflict, keeping both sides' entries
- [ ] 2.2 Push the merge so the PR reports a clean mergeable state

### Phase 3: Verification

- [ ] 3.1 Run the full `validation.commands` gate against the merged branch and fix any failure the merge introduced
- [ ] 3.2 Run the authoritative code-review pass (`om-auto-review-pr 6077 --autofix`) and land its fixes

### Phase 4: Finalize

- [ ] 4.1 Post the outcome and handoff comment, normalize labels (keeping `needs-qa` — the change is user-facing), and release the lock
