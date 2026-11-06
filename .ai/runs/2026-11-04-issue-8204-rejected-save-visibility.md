# Issue 8204 — rejected-save visibility

## Goal
Expose and focus the actual save rejection in long CrudForms, embedded dialogs and staff task drawers, without scrolling successful saves.

Source doc: .ai/specs/2026-11-04-issue-8204-rejected-save-visibility.md
Spec PR: https://github.com/open-mercato/open-mercato/pull/8671
Issue: https://github.com/open-mercato/open-mercato/issues/8204
Baseline: e5774a707321fe14867a19663bc486d7a001492d
Runner: local (no running compose app)
Engine: om-auto-create-pr (steps: 3, --loop: no)

## Scope
CrudForm and tests; existing shared error presentation and a shared focus/reveal helper; staff TaskDrawer and tests; uniquely named issue integration/run artifacts. No primitive, API, database, governance, Markdown, DataTable, audit log, customer, sales or document production source changes. The coordinated scope also covers field-scoped validation locators in the existing TC-CAT-002, TC-CGRP-022 and TC-CRM-002 integration tests, preserving their existing assertions. Parent-coordinated dependent coverage also scopes the existing CreateDealForm validation assertion to the live field wrapper and separately checks the actual summary; customer production code is unchanged.

## Implementation Plan
### Phase 1: Shared rejection presentation
1.1 Implement shared focus/reveal helper, integrate real error consumers, and add component regressions.
### Phase 2: Browser verification
2.1 Ship self-contained integration coverage for long form/dialog, drawer claim/stale rejection, repeat failures, and success.
### Phase 3: Validation and review
3.1 Run configured validation in order, independent code review, UI evidence and publication chain; document blockers and outstanding checks accurately.

## Risks
- Focus must follow explicit rejection identity, not ordinary error/edit state churn.
- Oversized messages and nested scroll containers need real viewport assertions.
- Historical native runtime failures are preserved; completed actual UI exploration and exact-head CI supply the accepted integration evidence.
- The design shipped separately through PR #8671 and is included through the canonical-main merge, not copied into the implementation patch.

## Progress

PR: #8672

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared rejection presentation
- [x] 1.1 Implement shared focus/reveal helper, integrate real error consumers, and add component regressions.
### Phase 2: Browser verification
- [x] 2.1 Ship self-contained integration coverage for long form/dialog, drawer claim/stale rejection, repeat failures, and success.
### Phase 3: Validation and review
- [ ] 3.1 Run configured validation in order, independent code review, UI evidence and publication chain; document blockers and outstanding checks accurately.

## Current validation state

Verified candidate: `315ff6ee628416c9079b49ce32a24a7b2d37273e`. Exact commands, timings, earlier failures and limits are in [.ai/analysis/issue-8204-validation.md](../analysis/issue-8204-validation.md).

All eight configured commands passed sequentially on this candidate with official Node 24.22.2 and Yarn 4.17.1: package build, generation, package rebuild, translation sync, translation usage, typecheck, full unit tests and application build. Full tests passed 51/51 tasks (five cached); the app build passed without a cache hit. Normal hooks passed, source and lock remained unchanged, and all owned validation processes exited.

Field-only injection rejection regressions passed 10 tests, failed two expected cases against the preceding source, then passed all 10 after exact restoration. The dependent CreateDealForm suite passed all nine tests using current DOM references while preserving inline and summary message checks and the successful retry. Earlier ambiguous-global-text and stale-reference failures are retained as change-related failures, not waived.

Four self-contained issue integration specs and three adjusted existing cases passed in native CI run41849313454 at coverage commit4d568dfd. Completed manual exploration and screenshots demonstrate the long page, dialog and drawer rejection/retry paths. Mobile, role/locale and full performance coverage remain unexercised; no QA approval is claimed.

After the gate passed, comparison with the concurrently published drawer Select teardown repair revealed an additional focus race absent from this candidate. That isolated repair is content-approved and preserved by ordinary merge `bfb236ae7e568069a9867ab5fa94fff0ac23270a`; combined-source validation remains outstanding. Phase3 stays open until final same-PR publication, current-head review and claim cleanup are complete. Check the PR for the published head and current CI; historical CI is not represented as a run against an unpublished candidate.
