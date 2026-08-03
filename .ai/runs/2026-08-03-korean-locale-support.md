# Korean Locale Support

## Goal

Reimplement the Korean locale feature from PR #4007 on current `develop` as a maintainer-authored, CLA-compatible replacement while preserving clear credit to original contributor `@moduvoice`.

## Scope

- Register `ko` across shared locale configuration and every exhaustive locale consumer.
- Keep the main app and `create-app` template dictionary loaders and language labels synchronized.
- Carry forward the original Korean catalogs, update them for current `develop`, and make `yarn i18n:check-sync` enforce complete Korean key and placeholder parity.
- Add the requested self-contained integration coverage for selecting, persisting, rendering, and resetting the Korean locale.
- Open a replacement PR that says `Supersedes #4007`, credits `@moduvoice`, and closes the original PR only after the replacement is ready for review.

## Non-goals

- Do not alter locale persistence semantics, translation-key naming, or fallback behavior beyond adding Korean as a supported locale.
- Do not refactor unrelated i18n infrastructure or change non-Korean copy.
- Do not weaken the i18n sync gate to accommodate missing Korean translations.

## Implementation Plan

### Phase 1: Rebase the Korean locale onto current develop

- Reapply the supported-locale wiring and synchronized app/template loader changes from PR #4007.
- Carry forward the original Korean catalogs, credit `@moduvoice`, and translate current-base parity gaps while preserving placeholders.

### Phase 2: Lock in the user flow

- Explore the running backend locale picker and add a self-contained integration test for Korean selection, persistence, rendering, reload behavior, and English reset.

### Phase 3: Verify and prepare the superseding PR

- Run targeted locale parity, type, and integration checks and resolve every failure.
- Run the configured full validation gate and authoritative review/autofix pass, then finalize the replacement PR and superseding notice.

## Risks

- The locale union is an additive public type change; exhaustive `Record<Locale, ...>` consumers must all include `ko`.
- Translation catalogs span many packages, so key and interpolation parity must be machine-checked against current `develop`.
- Browser coverage depends on a runnable shared test environment; any infrastructure blocker must be documented without weakening the test.
- The original PR touched `packages/enterprise`; this maintainer-authored replacement may carry those translations, while the external-contribution restriction remains unchanged.

## Attribution

This run is based on the Korean localization contributed by `@moduvoice` in PR #4007. The replacement uses new maintainer-authored commits for CLA compatibility while preserving visible credit in this plan, the replacement PR, and the superseding notice.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Rebase the Korean locale onto current develop

- [ ] 1.1 Reapply supported-locale wiring and synchronized app/template loader changes
- [ ] 1.2 Carry forward credited Korean catalogs and complete current-base parity

### Phase 2: Lock in the user flow

- [ ] 2.1 Add observed integration coverage for Korean selection, persistence, rendering, reload, and reset

### Phase 3: Verify and prepare the superseding PR

- [ ] 3.1 Pass targeted locale parity, type, and integration checks
- [ ] 3.2 Pass the full validation and review gates and finalize the superseding PR
