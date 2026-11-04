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
CrudForm and tests; existing shared error presentation and a shared focus/reveal helper; staff TaskDrawer and tests; uniquely named issue integration/run artifacts. No primitive, API, database, governance, Markdown, DataTable, audit log, customer, sales or document production source changes. The coordinated scope also covers field-scoped validation locators in the existing TC-CAT-002, TC-CGRP-022 and TC-CRM-002 integration tests, preserving their existing assertions.

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
- Browser integration and screenshots require a bootable isolated app. The existing local descriptor is stale; an isolated disposable environment is required.
- Spec stays on separate design branch per feature-route contract and is materialized locally but not committed here.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared rejection presentation
- [x] 1.1 Implement shared focus/reveal helper, integrate real error consumers, and add component regressions.
### Phase 2: Browser verification
- [ ] 2.1 Ship self-contained integration coverage for long form/dialog, drawer claim/stale rejection, repeat failures, and success.
### Phase 3: Validation and review
- [ ] 3.1 Run configured validation in order, independent code review, UI evidence and publication chain; document blockers and outstanding checks accurately.

## Current validation state

Source commit: `4ab9dee741`. Review evidence: [.ai/analysis/issue-8204-validation.md](../analysis/issue-8204-validation.md).

All 63 focused component tests pass with the unmodified native UI/core package test scripts (15 UI and 48 core); the earlier supplemental config also passed. Six visibility cases fail against the baseline source, while successful saving passes. The generic root Jest entrypoint fails TS5011 before tests, including an untouched suite; package-native scripts work and the repository configuration is unchanged. An unrelated optimistic-lock test also reproduces a missing JSDOM Response global on baseline.

Both package builds, generation and translation sync passed. Translation usage timed out after 1800 seconds. A subsequent native typecheck passed all 42 tasks. The full local test/app-build checks and native browser integration remain incomplete; the draft PR review requests changes until these gates are satisfied. Independent source review found no outstanding source defects. No QA approval is claimed.

Live UI exploration is complete on the owned native runtime: long-form oversized/repeated errors, embedded-dialog rejection/keyboard retry, real drawer claim race, stale status rejection, and successful retry. Four self-contained integration specs were authored afterward, received read-only approval, and were run with the three corrected existing scenarios: three passed and four timed out. A reviewed cleanup correction requires reruns; the subsequent successful native app build could not reach authenticated readiness after Docker became unavailable. Both native application builds passed; these are distinct from the previously incomplete configured local build gate.
