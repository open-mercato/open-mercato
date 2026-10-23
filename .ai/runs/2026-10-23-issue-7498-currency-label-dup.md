# Execution plan — finish currency selector regressions (adopted from PR #7523)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-23 because PR #7523 carried no execution plan.
**PR:** #7523 · **Branch:** `fix/issue-7498-currency-label-dup` · **Base:** `main`
**Author:** @pidubiel — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## Goal

Display each currency code once in both CRM deal selectors, preserve persisted codes and ordering, and satisfy the outstanding review with component and browser regressions.

## Scope

Customers-module currency selector tests, their typed mocks, and self-contained module-local browser coverage. Preserve the existing production formatter unless verification exposes a defect.

## Non-goals

No currency-module migration, monetary calculations, dictionary data rewrite, generic selector changes, API/schema changes, deployment security changes, or automatic merge. QA approval remains a maintainer/reviewer gate.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Production display fix is present and considered correct | PR #7523 body, five-file diff, review by @haxiorz at 5a994d6ae3 | high |
| DealForm needs an independent consumer regression | Review major finding and handoff comment | high |
| Both variants need selection/save/reopen browser coverage | Issue #7498 acceptance criteria and review | high |
| Selector mock must use exported types instead of any | Review minor finding | high |
| CI and manual QA remain merge gates | Review CI follow-up and needs-qa label | high |

## Assumptions

The goal remains the narrowly scoped display correction described in issue #7498. The existing production implementation should remain unchanged if the new tests pass. Interactive adoption uses the skill's default ask mode: implementation starts after plan confirmation.

## Risks

Browser fixtures must be isolated by organization/tenant and cleaned up. Fork workflows may require maintainer approval. GitHub denied assignment and label changes for the current account; the existing assignee is already @pidubiel and the claim is recorded in a comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Share customers-local currency label formatting across both selectors and add helper/create-field tests — 5a994d6ae3

### Phase 2: Address review coverage and typing

- [ ] 2.1 Type the create-field selector mock using exported props/options and typed React imports
- [ ] 2.2 Add DealForm currency callback regression for labels, selected text, ordering, and submitted codes; prove it catches reverting only that call site
- [ ] 2.3 Add self-contained browser selection/save/reopen coverage for both deal form variants with fixture cleanup

### Phase 3: Verify and report

- [ ] 3.1 Run targeted component/browser verification and capture available UI evidence
- [ ] 3.2 Run the configured full validation gate and document any maintainer-only CI execution blocker
- [ ] 3.3 Run om-auto-review-pr with autofix, update PR evidence, and hand off remaining manual QA

## Validation

Select the Docker/local runner according to `.ai/docs/agent-instructions.md` when implementation resumes. The configured ordered gate is: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`. Run targeted tests for both selector consumers and the new module-local browser cases before that gate. No implementation tests run during adoption-only planning.

## Handoff

Resume at 2.1 after confirming this adopted plan with `/om-auto-continue-pr 7523`. No implementation changes have been made in this adoption pass.
