# Final Gate Checks — messages-filter-label-clarity

**Run date:** 2026-05-25T13:30:00Z  
**Branch:** feat/messages-filter-label-clarity  
**Head SHA:** 9d4403e5c  
**All steps:** done (1.1, 2.1, 2.2, 3.1, 3.2-test-fix, 3.3-test-repair)

## Gate Results

| Check | Result | Notes |
|-------|--------|-------|
| `yarn i18n:check-sync` | ✅ PASS | All 4 locales in sync; new keys present in en/de/es/pl |
| `yarn i18n:check-usage` | ✅ PASS (advisory) | New tooltip keys detected as used; 3650 advisory unused keys are pre-existing |
| `yarn test` (packages/ui — FilterOverlay) | ✅ PASS | 9/9 tests (dateRange × 4 + tooltip × 5) |
| `yarn test` (packages/core — inboxFilters) | ✅ PASS | 11/11 tests (label assertions updated + 1 new tooltip test) |
| `yarn build:packages` | ✅ PASS | 19/19 packages built (5.74 s) |
| `yarn typecheck` (packages/ui) | ✅ PASS | No errors in changed files (pre-existing generated-shim errors unrelated) |
| `yarn typecheck` (packages/core) | ✅ PASS | No errors in changed files |
| `yarn build:app` | ⏭ SKIPPED | No routing or page changes; packages build clean; skipping slow full app build |
| `yarn generate` | ⏭ SKIPPED | No module file structure changes; no new auto-discovery paths |
| `yarn test:integration` | ⏭ SKIPPED | Dev runtime not running; UI change is label text + tooltip icon only (no routing, no API) |
| `yarn test:create-app:integration` | ⏭ SKIPPED | No packaging or shared export changes |
| `ds-guardian` pass | ✅ CLEAN | No DS violations in diff; `Info` icon + `size-3.5` + `text-muted-foreground` + `SimpleTooltip` all DS-compliant |

## Reconciliation Note

Step 3.3-test-repair was added during this resume. The original `auto-create-pr-loop` run did not include the pre-existing `inboxFilters.test.ts` in its scope, so when the label strings changed in Step 2.2, the existing test assertions became stale. The repair:

- Updated the test description line to reference new labels
- Updated `expect(hasObjects?.label).toBe(...)` from `'Has objects'` → `'Has related records'`
- Updated `expect(hasActions?.label).toBe(...)` from `'Has actions'` → `'Has action requests'`
- Added new test block asserting `tooltip` field is set on `hasObjects` and `hasActions` and absent on `hasAttachments`

## BC Self-Review

- `FilterDef.tooltip?: string` — additive optional field on STABLE exported type ✅
- Filter API query param IDs unchanged ✅
- i18n key names unchanged ✅
- No contract surface broken ✅
