# Execution plan — unique live claim line numbers (adopted from PR #7359)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-25 because PR #7359 carried no execution plan.
**PR:** #7359 · **Branch:** `codex/fix-issue-7306-line-numbers` · **Base:** `main`
**Author:** @haxiorz — this plan interprets the existing PR scope.

## Goal
Keep live line numbers unique while retaining current-main lifecycle/version undo protections and retry after a numbering conflict.

## Scope
Warranty command conflict resolution, focused regressions, conflict-message copy, and documentation for this PR.

## Non-goals
Merge the PR, approve manual QA, or incorporate other open warranty PRs.

## Evidence
| Conclusion | Drawn from | Confidence |
| --- | --- | --- |
| Preserve number guards and historical duplicates behavior | PR body, issue #7306, existing tests | high |
| Integrate current undo protections | review 5564654199 and Kapsik89 QA comment 6202109430 | high |
| Correct actionable conflict feedback | Kapsik89 QA comment 6202109430 | high |
| Manual QA remains gated | needs-qa label and review | high |

## Assumptions
The live PR base `main` is authoritative; older references to develop describe the same integration task. Focused regression fallback is appropriate before a new-head CI run exists, then new-head CI remains authoritative.

## Risks
Undo conflict resolution could drop lifecycle/version checks or block retry after a number is freed. Existing and combined regressions cover both guards.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Add live line-number guards and regression coverage — 65b31bfac844c4bc256350486efa30a3638273a8

### Phase 2: Current review remediation

- [x] 2.1 Integrate current main while preserving uniqueness, undo protection, and retry semantics — 063fb3cf0
- [x] 2.2 Correct conflict feedback and validate resolved command paths — 063fb3cf0
- [ ] 2.3 Review final diff, publish evidence, and request human re-review

## Verification evidence

Runner: local. Current source command regressions: 89/89 pass. Focused ESLint, lessons checker and its 5 tests, translation synchronization, and template parity pass. Playwright discovers all 7 cases in TC-WC-038 (renamed because current main owns portal-upload TC-WC-037). A fresh live API/browser run is unavailable because no disposable application is running. The broad warranty fallback is not green: 48/63 suites and 552/561 tests passed; missing shared test dependencies, absent generated fixtures, and Windows Polish number formatting block the remaining coverage. The translation-usage scan did not finish within the local fallback window. New-head CI and manual QA remain external gates.
