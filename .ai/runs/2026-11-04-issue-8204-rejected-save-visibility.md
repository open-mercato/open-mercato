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
CrudForm and tests; existing shared error presentation and a shared focus/reveal helper; staff TaskDrawer and tests; uniquely named issue integration/run artifacts. No primitive, API, database, governance, Markdown, DataTable, audit log, customer, sales or document source changes. Reuse cezar's existing worktree/branch.

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
- Browser integration and screenshots require a bootable isolated app. The existing descriptor is stale; this worktree has no prepared environment and migration execution is outside the task authorization.
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

63 component tests pass using a supplemental temporary Jest configuration that explicitly supplies TypeScript `rootDir`; the repository-native Jest invocation fails TS5011 before tests (also reproduced with an untouched suite). This supplemental result does not satisfy the configured gate. Both package builds, generation and translation sync passed; the remaining gate is in progress. Independent source review approved after addressing stale drawer notices and empty transformed validation messages. Browser integration coverage and screenshots remain outstanding, so the implementation PR remains draft.
