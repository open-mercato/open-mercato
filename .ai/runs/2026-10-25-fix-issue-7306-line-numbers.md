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
- [x] 2.3 Review final diff, publish evidence, and request human re-review — 1c0276d7b

## Verification evidence

Runner: local. Current source command regressions: 89/89 pass. Focused ESLint, lessons checker and its 5 tests, translation synchronization, and template parity pass. Playwright discovers all 7 cases in TC-WC-038 (renamed because current main owns portal-upload TC-WC-037). A fresh live API/browser run is unavailable because no disposable application is running. The broad warranty fallback is not green: 48/63 suites and 552/561 tests passed; missing shared test dependencies, absent generated fixtures, and Windows Polish number formatting block the remaining coverage. The translation-usage scan did not finish within the local fallback window. New-head CI and manual QA remain external gates.

## CI follow-up — 2026-10-25

CI prepare failed on `1c0276d7b` with TS18048 at claims.ts:684–685. The async localized refusal returned a promise from a synchronous projection callback without terminating it. The projection now uses a loop and returns the refusal from the enclosing async restore, preserving the conflict response before any mutation. A missing-before-line snapshot regression complements the existing number-conflict and historical-duplicate coverage.

### Phase 3: CI type narrowing correction

- [x] 3.1 Propagate the async missing-snapshot refusal and verify strict compiler plus command regressions — feebf5d77
- [ ] 3.2 Publish the follow-up evidence and re-request human review

Follow-up validation: the real TypeScript 6.0.3 compiler reproduced all six TS18048 diagnostics on the previous source, then returned no options, syntactic, or semantic diagnostics for the actual `claims.ts`, `claim-lines.ts`, and `shared.ts` source using current app compiler options. The scoped compiler script and before/after logs live in the temporary review handoff directory. Command regressions now pass 90/90, focused ESLint passes, and the lessons checker plus its five tests pass. No broad unrelated unit rerun was performed. Current-head CI and manual/live QA remain external gates.
