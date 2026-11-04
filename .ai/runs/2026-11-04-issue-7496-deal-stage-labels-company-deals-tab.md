# Execution plan — show pipeline-stage labels on the detail Deals tab (adopted from PR #7528)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-11-04 because PR #7528 carried no execution plan.
**PR:** #7528 · **Branch:** `fix/issue-7496-deal-stage-labels-company-deals-tab` · **Base:** `main`
**Author:** @pidubiel — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal
Make PR #7528 (fix for #7496) merge-ready by addressing the changes-requested review of 2026-10-16 on the integration test, without touching the already-approved production fix.

## Scope
- `packages/core/src/modules/customers/__integration__/TC-CRM-7496-company-deals-tab-stage-label.spec.ts`
- Bringing the branch up to date with `main` so CI runs against the current base.

## Non-goals
- No change to `DealsSection.tsx` or its unit tests — the review found no production defect.
- No change to the shared Playwright runner timeout configuration.

## Evidence
| Conclusion | Drawn from | Confidence |
|---|---|---|
| Production fix is correct; only test conventions block | haxiorz review (CHANGES_REQUESTED, 2026-10-16) | high |
| Imports must use `@open-mercato/core/helpers/integration/*` | same review, minor #1; `.ai/qa/AGENTS.md` | high |
| `test.slow()` must be removed | same review, minor #2 | high |
| Locator anchoring and cleanup diagnostics are optional nits | same review, nits; earlier self-review | high |

## Assumptions
- The two optional nits are cheap and are applied too; they can be reverted independently if unwanted.
- Merging `main` (not rebasing) is the most reversible way to refresh the base without rewriting history.

## Risks
- The branch is ~417 commits behind `main`; the merge may surface unrelated CI noise.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Resolve deal pipeline stage through the pipeline-stages dictionary with unit and browser coverage — e009d74cd4

### Phase 2: Address review feedback

- [x] 2.1 Merge latest main into the PR branch — 6d9cfea48f
- [x] 2.2 Switch integration test to published helper import paths — 12bea2a761
- [x] 2.3 Remove the per-test timeout override — 12bea2a761
- [x] 2.4 Anchor the stage locator and surface dictionary cleanup failures — 12bea2a761
