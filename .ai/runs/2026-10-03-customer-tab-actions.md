# Customer detail tab action deduplication

Source doc: .ai/specs/2026-10-03-customer-tab-actions.md
Spec PR: #6873
Issue: #6859

## Goal

Show one Add action in customer Deals and company People tabs, alongside their existing linking controls.

## Scope

Change `DealsSection`, `CompanyPeopleSection` and their unit/browser tests. Keep callback types, local controls, dialogs, empty states, translations and all data paths.

## Implementation Plan

### Phase 1: Correct duplicated actions

1.1 Add regression tests proving local creation works without header registration.
1.2 Replace duplicate action registration with null notification and cleanup.

### Phase 2: Validate and publish

2.1 Run configured validation, review and UI evidence checks, documenting external blockers.

## Risks

Unit regression: the three new assertions fail before the implementation and all 28 section tests pass afterward. Browser coverage is in `TC-CRM-6859.spec.ts` for the six affected classic/v2 tabs.

Preserve dialog click handlers and tab cleanup. Dependencies are installed with the immutable lockfile. Customer validation passes (94 suites / 473 tests). Both package build passes, generation, locale checks, typecheck, app build and template parity pass. The full workspace `yarn test` gate fails in three unchanged documents suites because `packages/documents/jest.config.cjs` does not map `#generated/entities.ids.generated`; the import reaches the core generated shim through `AttachmentMetadataDialog`.

All six browser regressions pass at 1440×960 without retries or skips. The first disposable boot rejected a placeholder JWT secret; the retry used a generated process-only secret. The native CLI removed its app/database afterward. [UI evidence](https://github.com/open-mercato/open-mercato/pull/6874#issuecomment-5963349688) includes six inspected screenshots and explicitly leaves empty/loading/error/restricted-role/long-content/mobile checks for manual QA.

[Code review](https://github.com/open-mercato/open-mercato/pull/6874#issuecomment-5963257858) found no additional customer-code findings. GitHub rejects a formal review from the PR author; an independent reviewer must submit it. The required CI [`test` check](https://github.com/open-mercato/open-mercato/actions/runs/37078722262/job/111075652358) fails in two unchanged `communication_channels` share-conflict tests: they expect a button in the visibility cell, but sharing is now offered from the action menu (2,019 core suites / 18,298 tests otherwise pass). The PR stays draft with `Status: in-progress` while the full gate remains blocked. Resume with `om-auto-continue-pr 6874` after resolving the validation blocker; manual QA remains required.

## Progress

PR: #6874

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Correct duplicated actions

- [x] 1.1 Add regression tests proving local creation works without header registration. — 71392443a3
- [x] 1.2 Replace duplicate action registration with null notification and cleanup. — 71392443a3

### Phase 2: Validate and publish

- [ ] 2.1 Run configured validation, review and UI evidence checks, documenting external blockers.
