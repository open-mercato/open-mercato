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

- [x] 2.1 Merge current main preserving origin guards and localized refusal behavior — ee11fa35a
- [x] 2.2 Repair authenticated refusal fixtures and assign a unique integration ID — ee11fa35a
- [x] 2.3 Validate the merged commands, integration discovery, compiler/lint, and lessons catalog — ee11fa35a
- [x] 2.4 Publish findings resolution and request human re-review — d78650250

## Validation evidence

Runner: local. No running compose app or reusable test-environment descriptor was available. Fresh current-head CI is still required for the configured full gate and live integration execution.

- Proposal command + proposal-origin suites: 39/39 passed.
- Message action concurrency + compose route suites: 38/38 passed.
- Focused semantic compilation of both affected commands and TC-013/014: passed using this checkout's sources and installed dependency types.
- Changed-file ESLint: passed.
- TC-012/013/014 Playwright discovery: exactly three tests in three files.
- Lesson validator and its five focused tests: passed; merged catalog count is correct.
- `git diff --check`: passed.
- The initial broad package compiler attempt lacked installed drag-and-drop types; the source-mapped focused compiler used verified installed types and passed. Full package compilation also traversed unrelated AI SDK/generation dependencies unavailable in the local runtime. No full-gate result is claimed for this merged head.
- Existing manual QA was performed on a locally adapted cherry-pick; no new QA approval was granted.

