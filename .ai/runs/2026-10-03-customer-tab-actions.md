# Customer detail tab action deduplication

Source doc: .ai/specs/2026-10-03-customer-tab-actions.md
Spec PR: #6873
Issue: #6859

## Goal

Show one Add action in customer Deals and company People tabs, alongside their existing linking controls.

## Scope

Change `DealsSection`, `CompanyPeopleSection` and their unit/browser tests. Align the existing communication-channel share-conflict test with its current row-actions menu so CI can exercise its retained conflict/error assertions. Keep callback types, local controls, dialogs, empty states, translations and all data paths.

## Implementation Plan

### Phase 1: Correct duplicated actions

1.1 Add regression tests proving local creation works without header registration.
1.2 Replace duplicate action registration with null notification and cleanup.

### Phase 2: Validate and publish

2.1 Run configured validation, review and UI evidence checks, documenting external blockers.

## Risks

Unit regression: the three new assertions fail before the implementation and all 28 section tests pass afterward. Browser coverage is in `TC-CRM-6859.spec.ts` for the six affected classic/v2 tabs.

Preserve dialog click handlers and tab cleanup. Dependencies are installed with the immutable lockfile. Customer validation passes (94 suites / 473 tests). Both package build passes, generation, locale checks, typecheck, app build and template parity pass.

All six browser regressions pass at 1440×960 without retries or skips. The retry used a generated process-only JWT secret after the initial disposable boot rejected its placeholder. The native CLI removed its app/database afterward. [UI evidence](https://github.com/open-mercato/open-mercato/pull/6874#issuecomment-5963349688) includes six inspected screenshots and leaves empty/loading/error/restricted-role/long-content/mobile checks for manual QA.

CI repair: the failed `test` job expected an inline Share with team button after the action moved to the row menu. Commit `6d96b12853` updates only that regression's interaction, retaining the 409 conflict-bar and 500 error-toast assertions. Both related suites pass (19 tests), and core typecheck passes. The documents suites now pass after completed generation/build preparation (154 suites / 1,008 tests); no documents configuration change was needed.

The broader local `yarn test` rerun passes 45 tasks but is limited by create-app harness child processes aborting with SIGABRT on macOS; it interrupts the remaining core run. Validation source is the required GitHub checks under the repository's GitHub-checks-first review rule. Their new-head results are pending. This platform limitation is recorded without changing unrelated harness source or bypassing its checks.

[Code review](https://github.com/open-mercato/open-mercato/pull/6874#issuecomment-5963257858) records the analysis. GitHub rejects a formal review from the PR author; an independent reviewer and manual QA must sign off. The PR remains draft with `Status: in-progress` until the required new-head checks settle.

## Progress

PR: #6874

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Correct duplicated actions

- [x] 1.1 Add regression tests proving local creation works without header registration. — 71392443a3
- [x] 1.2 Replace duplicate action registration with null notification and cleanup. — 71392443a3

### Phase 2: Validate and publish

- [x] 2.1 Run configured validation, review and UI evidence checks, documenting external blockers. — 6d96b12853
