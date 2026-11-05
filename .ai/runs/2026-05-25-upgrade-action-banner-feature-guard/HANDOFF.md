# Handoff: upgrade-action-banner-feature-guard

## Status: complete

## Run completed: 2026-05-25

## What was done

Gated `UpgradeActionBanner` on the `configs.manage` RBAC feature via `useBackendChrome` to prevent an infinite redirect loop for users who lack the feature when `NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED=true`.

## Files changed

- `packages/ui/src/backend/upgrades/UpgradeActionBanner.tsx` — added `useBackendChrome` + `hasFeature` guard
- `packages/ui/src/backend/__tests__/UpgradeActionBanner.test.tsx` — new unit tests (4 cases)

## Branch

fix/upgrade-action-banner-feature-guard

## Commits

1. `f5965e34f` — docs(runs): add execution plan for upgrade-action-banner-feature-guard
2. `70e3196cc` — fix(ui): gate UpgradeActionBanner on configs.manage feature to prevent redirect loop
