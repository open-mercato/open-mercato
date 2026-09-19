# Handoff - 2026-09-19-us-state-dropdown-in-address-forms

**Last updated:** 2026-09-19T13:10:00Z
**Branch:** feat/us-state-dropdown-in-address-forms
**PR:** https://github.com/systevio/open-mercato/pull/12 (draft)
**Current phase/step:** Phase 2 Step 2.1
**Last commit:** c07dfc98d — feat(customers): drive the AddressEditor region control from the address country

## What just happened
- Phase 1 landed in four commits: the two shared accessors, the country-aware `resolveAddressLayout` plus the
  name-tolerant `validateAddressForProfile`, and both `AddressEditor` twins with nine RTL assertions each.
- Checkpoint 1 is green: shared, ui and the customers AddressEditor suites, `build:packages` and `typecheck` all pass.
  See `checkpoint-1-checks.md`.

## Next concrete action
- Step 2.1: replace the hook-time `select` / `text` branch in
  `packages/core/src/modules/sales/components/channels/channelFormFields.ts` with one `custom` field backed by a
  `ChannelRegionField` component, and add `sales/components/__tests__/channelRegionField.test.tsx`.

## Blockers / open questions
- none

## Environment caveats
- Dev runtime runnable: yes - slot 2, port 3120, https://task2-om.systevio.dev, log `.omw-dev.log`
- Browser / UI checks: deferred to the integration Steps 2.3 and 2.4 and the QA pass on the finished PR
- Database/migration state: clean - shared instance database, this change adds no migration

## Worktree
- Path: /srv/om/repos/open-mercato/.ai/cezar/worktrees/56213223-b2c8-420e-b8c5-197182a4868a
- Created this run: no (the cockpit task worktree is reused)
