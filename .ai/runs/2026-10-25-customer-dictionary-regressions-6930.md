# Execution plan — customer dictionary regression coverage (adopted from PR #6930)

**Origin:** adopted by `om-auto-continue-pr` on 2026-10-25 because this PR has no tracking plan.
**PR:** #6930 · **Branch:** `codex/fix-6197-customer-dictionary-translations` · **Base:** `main`
**Author:** @haxiorz

## Goal
Complete the remaining review requests for customer dictionary localization with self-contained API and browser regressions.

## Scope
Customer dictionary integration tests and the existing localization specification's verification description.

## Non-goals
No production behavior changes, generic TranslationManager HTTP-500 repair, database migration, dependency change or QA approval.

## Evidence
| Conclusion | Source | Confidence |
|---|---|---|
| Localization, base-label editing and shared base cache are implemented | PR #6930 at c10be753a2173eab1459500a3dec844ee13eebe4 | high |
| Browser selection/save and Polish/English Source filters need coverage at 390px | Review 5564725069; issue comment 5987344803; existing browser evidence 5987339734 | high |
| The seeded status API test needs a fresh organization and exact active/Active fixture | Review 5564725069 | high |
| Generic TranslationManager failed-read behavior belongs to separate work | Human review 5441671288 | high |

## Assumptions
The current PR base `main` is authoritative. Existing shared integration helpers and current semantic controls remain the reference for tests. New-head CI is authoritative when no disposable local app is running.

## Risks
The new UI scenario must run against the real dispatcher and browser; static discovery alone does not establish that the browser flow passes. Human QA remains required.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed

- [x] 1.1 Implement localization, base-label editing and locale-independent server cache — c10be753a2173eab1459500a3dec844ee13eebe4

### Phase 2: Regression coverage

- [x] 2.1 Isolate the seeded status API regression with exact fixtures and cleanup — a35b24fc2c3dbb92151205f90a142c91f30d4b25
- [x] 2.2 Cover TranslationManager selection/save and Polish/English Source filters at 390px — a35b24fc2c3dbb92151205f90a142c91f30d4b25

### Phase 3: Verification and handoff

- [ ] 3.1 Validate discovery and types, inspect CI and review the final diff
- [ ] 3.2 Publish evidence and request human reassessment while preserving QA gates

## Validation evidence

Runner: local, narrow fallback using the existing shared dependency runtime through task-local links. No shared dependency or application mutation.

- Strict no-emit typecheck of both changed specs and their shared helpers: passed.
- Scoped Playwright discovery: passed, 5 tests in 3 files (including the new browser scenario).
- `git diff --check`: passed.
- `git merge-tree --write-tree HEAD upstream/main`: clean against current fetched `main`; no merge needed.
- Native repository-wide Playwright discovery was bounded and stopped after it produced no output. A temporary configuration outside the repository successfully discovered only the requested specs.
- No active disposable app or database was available locally. Browser/API execution is not claimed; new-head CI and human QA must provide that evidence.
- Earlier head c10be753 had green reported CI checks; those results are historical, not results for these new tests.
