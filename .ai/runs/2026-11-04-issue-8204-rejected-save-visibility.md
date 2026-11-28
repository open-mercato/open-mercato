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
- [x] 3.1 Run configured validation in order, independent code review, UI evidence and publication chain; document blockers and outstanding checks accurately. — d4e2a339a3932ffb32e098d6b7d1033f4cb33235

## Current validation state

Combined candidate: `10024a8575ab85584fd9a1942d102936b526b346`. [Exact commands, results and retained failures](../analysis/issue-8204-validation.md).

All eight configured commands passed in order on this combined source: package build, generation, package rebuild, translation sync, translation usage, typecheck, full unit tests and application build. Unit tests completed 51/51 tasks (five cached); the app build completed 1/1 without a cache hit. Normal hooks passed, source/index/lock stayed unchanged, and all owned validation processes exited.

The ordinary merge preserves the published Select teardown repair and the local field-only rejection fix. Focused native regressions passed 50 TaskDrawer, 10 CrudForm and 9 CreateDealForm tests. Independent combined-source content review has no remaining Medium-or-higher findings.

A supplementary Linux-script test run had 15 passes and three failures because GNU `timeout` is absent on the macOS host. No assertion or environment substitute was introduced. The actual Linux script job on published `d4e2a339` subsequently passed all five metadata cases. The earlier field-only baseline comparison, ambiguous dependent locator failure, stale DOM-reference failure, native integration timeouts and runtime failures remain documented honestly.

Native CI run 42165496818 on published `d4e2a339` passed all four new integration cases and five adjusted existing cases, each on its first attempt with no errors or retries. Actual manual UI exploration and five screenshots cover long-form, dialog, claim-race and stale-status rejection/retry. Prior-head evidence retains its source attribution; an earlier recovered drawer-status flake is not claimed causally fixed. Mobile, role/locale and full performance checks remain unexercised; no QA approval is claimed.

The implementation, configured validation, content review and evidence handoff are complete. The 40-minute CI watch ended at its configured limit; the last pre-expiry snapshot had 14 of 15 integration shards passing and shard 14 still running. The PR records the final published head and outstanding checks. No further CI follow-up is promised by this run; required CI, independent GitHub review and human QA still gate merge. This completion is an implementation handoff, not a merge-readiness claim.
