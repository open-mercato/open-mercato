# Execution plan — finish selected-organization feature-check fix (adopted from PR #5544)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-25 because PR #5544 carried no execution plan.
**PR:** #5544 · **Branch:** `fix/issue-5498-feature-check-org-scope` · **Base:** `develop`
**Author:** @haxiorz — this plan records the requested review follow-up on the existing branch.

## 🎯 Goal

Finish PR #5544 by correcting the two documentation issues requested in review while preserving the already-approved auth implementation and regression coverage for issue #5498.

## Scope

- Correct the remaining stale selected-organization rationale in `.ai/specs/2026-03-25-coherent-access-denied-ux.md`.
- Record the specification revision in that document's changelog.
- Re-run the repository validation gate and the authoritative PR review pass before handing the PR back for review.

## Non-goals

- Do not change the approved feature-check route implementation, unit test, or integration scenario.
- Do not address the reviewer-noted platform-level empty-organization-list divergence; it is explicitly non-blocking and outside this PR.
- Do not change API, database, UI, RBAC, or backward-compatibility contracts.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Feature checks must use the request-selected organization scope | Issue #5498, the PR description, and commit `f0f1e718a` | high |
| The code and tests require no changes | Requested-changes review by @pkarw on PR #5544 | high |
| One stale decision sentence and one missing changelog row block approval | Requested-changes review and handback comments on PR #5544 | high |
| Existing priority, risk, and QA labels remain appropriate | Review label rationale and green CI on `f0f1e718a` | high |

## External References

- https://github.com/open-mercato/open-mercato/issues/5498 — adopted as the defect and acceptance evidence.
- https://github.com/open-mercato/open-mercato/pull/5544 — adopted as the implementation, review, and CI evidence.
- https://github.com/open-mercato/open-mercato/pull/5544#issuecomment-5389762371 — adopted as the review handback scope.

## Assumptions

- The narrowest complete response is to make the two requested spec edits and leave the approved code unchanged.
- The existing `skip-qa`, `priority-medium`, and `risk-medium` labels remain valid because this resume only corrects documentation.

## Risks

- A documentation edit could accidentally broaden or reverse the original navigation decision; the diff and review pass must confirm that built-in navigation remains server-sourced.
- No runtime behavior is changed in this resume, so the residual product risk remains the already-tested auth behavior on the existing PR.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Align feature-check RBAC scope with the request-selected organization and add regression coverage — f0f1e718a

### Phase 2: Address requested documentation changes

- [ ] 2.1 Correct the remaining stale navigation rationale and add the specification changelog entry

### Phase 3: Validate and return for review

- [ ] 3.1 Run the configured validation gate and authoritative PR review pass, then update the PR handoff
