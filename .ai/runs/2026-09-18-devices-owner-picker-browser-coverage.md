# Execution plan: devices-owner-picker-browser-coverage

Source doc: `.ai/specs/2026-09-18-devices-owner-picker-browser-coverage.md`

## Goal

Add `TC-DEV-010.spec.ts`, a Playwright browser-level integration test covering the device owner combobox picker on Register device and the batched owner-column resolution on the devices list/detail pages, closing the gap left by API-only `TC-DEV-009`.

## Scope

- New file: `packages/core/src/modules/devices/__integration__/TC-DEV-010.spec.ts`.
- Reuse `authFixtures.ts` helpers for users/role fixtures; reuse the devices admin API for out-of-band device registration.
- No production code changes expected (test pins existing #5617 behavior).

## Non-goals

- No changes to `devices.admin` ACL declaration, `resolveDeviceUserOptions`, or `ComboboxInput`.
- No changes to `TC-DEV-009.spec.ts` or any other existing spec.
- No new UI or API surface.

## Implementation Plan

### Phase 1: Add browser-level owner picker and owner column coverage

- [ ] 1.1 Scaffold `TC-DEV-010.spec.ts`: describe block, setup fixtures (two named users, `devices.admin`-without-`auth.users.list` role, third user with only that role), `finally` teardown deleting devices/users/role.
- [ ] 1.2 Implement picker success + rejection assertions: hydration-safe typing helper, single matching option assertion, successful registration + flash, out-of-list UUID rejection.
- [ ] 1.3 Implement owner-column + detail-page assertions: API-registered device with unseen owner, list-page cells never match raw UUID pattern across pagination, detail page shows display name.
- [ ] 1.4 Implement ACL-degradation assertions: `devices.admin`-only user sees list render (no `/login` redirect), bare-id fallback, zero picker options.
- [ ] 1.5 Full suite run: `yarn test:integration` (or ephemeral variant) confirming `TC-DEV-010` passes deterministically alongside existing `TC-DEV-00x` specs.

## Risks

- Playwright hydration timing (`CrudForm` controlled-input gotcha) is the main flakiness risk; mitigated by waiting for hydration and asserting `inputValue()` before trusting the suggestion list, per the spec.
- Test-only change — no production blast radius.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Add browser-level owner picker and owner column coverage

- [x] 1.1 Scaffold spec file and fixtures
- [x] 1.2 Picker success + rejection assertions
- [x] 1.3 Owner column + detail page assertions (including pagination)
- [x] 1.4 ACL-degradation assertions
- [ ] 1.5 Full suite run and CI wiring check — could not execute the live Playwright run in this environment (no Docker for the ephemeral env, no running dev server); validated via `--list` discovery, `tsc`, `eslint`, and `i18n:check-hardcoded` instead. Flagging for human/CI verification.
