# Fix organization switcher for tenants without organizations

Issue: #7096
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Goal

Keep the backend organization switcher expandable for a superadmin when the selected tenant has no organizations, so the tenant selector and the `All organizations` option remain available.

## Scope

- Update the canonical `OrganizationSwitcher` top-bar rendering to treat tenant-switching and the all-organizations option as usable menu content even when the organization list is empty.
- Show the existing localized empty-state message inside the open organization menu when no organizations are available.
- Mirror the component change into the standalone-app template and add regression coverage for the no-organizations payload.

## Non-goals

- Do not change the directory API, tenant/organization data model, authorization rules, cookie behavior, or shared UI primitives.
- Do not alter compact/mobile switcher behavior beyond keeping the mirrored source identical.
- Do not add dependencies, migrations, or new translation keys.

## Implementation Plan

### Phase 1: Restore the usable switcher menu

- [x] 1.1 Allow the top-bar popover to render when a tenant selector or all-organizations option is available without organization rows. — 1e59110b2
- [x] 1.2 Render the existing localized `No organizations` message inside an otherwise empty organization section and mirror the component in the standalone template. — 1e59110b2

### Phase 2: Regression coverage and delivery validation

- [ ] 2.1 Add a component regression test for a superadmin payload with no organizations, then run the configured validation gate and resolve failures.
- [ ] 2.2 Complete the authoritative PR review/autofix pass and record the final verification result.

### Validation notes

- Targeted regression test passes: 1 suite, 5 tests.
- `yarn generate`, `TURBO_CONCURRENCY=4 yarn build:packages`, `TURBO_CONCURRENCY=2 yarn typecheck`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, and `TURBO_CONCURRENCY=2 yarn build:app` pass.
- Full `TURBO_CONCURRENCY=2 yarn test` reaches the configured gate but fails in unrelated pre-existing `@open-mercato/core` tests; no failure references the organization switcher change.
- Automated diff review found no correctness, security, compatibility, or scope findings. GitHub cannot accept an approval from the PR author, and the CLA check remains pending because the commit email is not linked to the GitHub account.

## Risks

- The change touches app-shell UI and its byte-identical standalone template mirror, so parity and user-facing validation are required.
- Existing behavior for users without tenant switching or all-organizations access must remain the static empty label.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

PR: #7111

### Phase 1: Restore the usable switcher menu

- [x] 1.1 Allow the top-bar popover to render when a tenant selector or all-organizations option is available without organization rows. — 1e59110b2
- [x] 1.2 Render the existing localized `No organizations` message inside an otherwise empty organization section and mirror the component in the standalone template. — 1e59110b2

### Phase 2: Regression coverage and delivery validation

- [ ] 2.1 Add a component regression test for a superadmin payload with no organizations, then run the configured validation gate and resolve failures.
- [ ] 2.2 Complete the authoritative PR review/autofix pass and record the final verification result.
