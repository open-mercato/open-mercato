# Run: upgrade-action-banner-feature-guard

## Tasks

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Add feature guard to UpgradeActionBanner + unit tests | todo | — |

## Goal

Fix infinite redirect loop for non-admin users when `NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED=true`. Gate `UpgradeActionBanner` API call and render on the `configs.manage` feature via `useBackendChrome`.

## Scope

Single file change: `packages/ui/src/backend/upgrades/UpgradeActionBanner.tsx`
New test file: `packages/ui/src/backend/__tests__/UpgradeActionBanner.test.tsx`

## Source Spec

`.ai/specs/2026-05-25-upgrade-action-banner-feature-guard.md`

## Implementation Plan

### Phase 1 — Feature guard

#### Step 1.1: Add feature guard to UpgradeActionBanner + unit tests

- Import `useBackendChrome` from `./BackendChromeProvider`
- Import `hasFeature` from `@open-mercato/shared/security/features`
- Inside `UpgradeActionBanner()`, call `useBackendChrome()` to get `{ payload, isReady }`
- Derive `const canManageConfigs = isReady && hasFeature(payload?.grantedFeatures, 'configs.manage')`
- Guard `loadNextAction` useCallback: add `if (!canManageConfigs) return` as FIRST guard, include `canManageConfigs` in deps array
- Guard render: extend `if (!upgradeActionsEnabled || !action)` to `if (!upgradeActionsEnabled || !canManageConfigs || !action)`
- Add unit tests covering: no-provider (isReady=true, payload=null), empty features, configs.manage present, configs.* wildcard
