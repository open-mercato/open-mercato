# Execution plan — localized Discord approval refusals (adopted from PR #7356)

**Origin:** adopted by `om-auto-continue-pr --adopt auto` on 2026-10-25 because this PR had no execution plan.
**PR:** #7356 · **Branch:** `fix/issue-7310-action-errors` · **Base:** `main`
**Author:** @haxiorz

## Goal
Preserve deliberate localized Discord approval refusals while integrating current proposal security and fixture contracts.

## Scope
Resolve the five conflicts against current main, retain proposal-origin and organization scoping, and repair the refusal integration fixture and colliding scenario ID.

## Non-goals
No changes to #7934, privately reported F-1, staff translations, UI polish, public contracts, automation policy, or QA approval.

## Evidence
| Conclusion | Drawn from | Confidence |
|---|---|---|
| Preserve localized 403/404 refusals and generic unexpected errors | PR #7356 and commit 15eca4271e | high |
| Preserve current origin/scoped proposal guards and resolve five conflicts | wojciechszyjka review 5643805518 | high |
| Use admin system-proposal fixtures, a unique ID, and authenticated cross-org 404 | Review and Kapsik89 QA comment 6398838563 | high |

## Assumptions
Merge current main without rewriting the existing branch history. Existing QA and CI are checkpoint evidence, requiring fresh validation after resolution.

## Risks
Conflict resolution touches authorization-sensitive commands; targeted unit suites must preserve forged-card generic errors, scoped source checks, and terminal claim release.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Preserve typed action errors and translate Discord source refusals — 15eca4271e

### Phase 2: Resolve current review

- [ ] 2.1 Merge current main preserving origin guards and localized refusal behavior
- [ ] 2.2 Repair authenticated refusal fixtures and assign a unique integration ID
- [ ] 2.3 Validate the merged commands, integration discovery, compiler/lint, and lessons catalog
- [ ] 2.4 Publish findings resolution and request human re-review
