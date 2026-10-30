# Checkpoint 3 — Phase 2 (part 2: cache, store + buyer resolution, /context, subscribers)

**Timestamp:** 2026-10-05T12:44:58Z
**Steps covered:** 2.5–2.9-fix (1b551a100e .. ad6984039f)
**Runner:** local mode
**Touched areas:** ecommerce lib (types, cacheKeys, storeContext, storeLocale, buyerContext, storeContextService, subscribers support), di.ts, public /context route, 11 subscribers.

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | 11 ecommerce subscribers + /context route registered |
| `yarn turbo run typecheck --filter=@open-mercato/core --force` | ✅ pass | |
| core tests (ecommerce, customer_groups, catalog, customer_accounts, src/__tests__) | ❌ → ✅ | first run: 1 failure — repo-wide `explicit-sort-comparators` guard flagged a bare `.sort()` in `buyerContext.ts:83`; fixed in 2.9-fix (ad6984039f); re-run 63/63 in the affected suites |
| eslint on touched dirs | ✅ no issues | core has no `lint` script; ran `npx eslint` directly |
| `yarn i18n:check-sync` | ✅ pass | |
| raw-cache structural guard | ✅ pass | |
| UI verification | ⏭️ skipped | no UI |
| Integration suite | ⏭️ next step | 2.11 runs in `yarn test:integration:ephemeral` (throwaway containers; local DB untouched) |
