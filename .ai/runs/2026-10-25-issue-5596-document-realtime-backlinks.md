# Execution plan — repair realtime setup guidance (adopted from PR #7626)

**Origin:** adopted by `om-auto-continue-pr --adopt auto` on 2026-10-25 because PR #7626 carried no tracking plan.
**PR:** #7626 · **Branch:** `fix/issue-5596-document-realtime-backlinks` · **Base:** `main`
**Author:** @haxiorz

## Goal

Finish #5596 by making the existing realtime setup guide reachable and consistent with the backend design system.

## Scope

Use one module-local exported URL constant in the editor and its existing unit/integration assertions, point it at the existing README section on `main`, and render the guide through `LinkButton`.

## Non-goals

No changes to collaboration transport, fallback saving, backlink authorization, public contracts, dependencies, or QA/review policy.

## Evidence

| Conclusion | Source | Confidence |
|---|---|---|
| Backlink repair and offline guidance already exist | PR #7626 head `e0f8ca8a`; issue #5596; collaborative-editor spec | high |
| The setup URL must use a real target and one shared constant | Review 5643594500 by @wojciechszyjka | high |
| The inline guide must use `LinkButton` | Same review; `.ai/ui-components.md` | high |
| Existing functionality has CI coverage | Successful CI run 39163934965 at `e0f8ca8a` | high |

## Assumptions

The existing README sidecar section is the intended setup guide. Its path and heading were verified on upstream `main` before editing.

## Risks

The setup link and inline presentation need focused validation. Existing `changes-requested` and `needs-qa` state remains pending human reassessment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Repair document backlinks and add localized realtime setup guidance — e0f8ca8ae2da2d04897ec6224236bbd752daf215

### Phase 2: Review remediation

- [ ] 2.1 Share the verified setup URL and use LinkButton
- [ ] 2.2 Run focused validation and review the final diff
- [ ] 2.3 Publish, report evidence, and request human re-review
