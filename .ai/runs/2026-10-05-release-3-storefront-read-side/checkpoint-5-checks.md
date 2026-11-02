# Checkpoint 5 — Phase 3 (part 1: Omnibus history foundation)

**Timestamp:** 2026-10-05T15:46:29Z
**Steps covered:** 3.1–3.3-fix (c7b5340eaf .. 26e58e3c80)
**Runner:** local mode
**Touched areas:** catalog `CatalogPriceHistoryEntry` + migration (immutability trigger), `lib/omnibus.ts` capture wired into price/product/variant commands and undo, `GET /api/catalog/prices/history` + `catalog.price_history.view`; auth i18n for ecommerce ACL titles.

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | |
| `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/shared --force` | ✅ pass | |
| `yarn workspace @open-mercato/core test` (FULL) | ⚠️ 19166 passed / 2 failed | both failures in `warranty_claims/__tests__/quantity.test.ts` — locale-dependent (`2,5` vs `2.5` under this machine's pl locale); passes 8/8 with `LANG=en_US.UTF-8`; module untouched by this PR → pre-existing environment noise |
| `yarn workspace @open-mercato/shared test` (FULL) | ✅ 2622 passed | |
| `yarn i18n:check-sync` | ✅ pass | |
| Immutability trigger | ✅ verified by executor on a throwaway postgres:16 container (UPDATE/DELETE rejected, idempotency unique) | local DB untouched |
| UI / integration | ⏭️ skipped | no UI; Omnibus integration suite is Step 3.9 |

Process fix: from this checkpoint on, the FULL core + shared unit suites run at every checkpoint (3.3-fix showed scoped runs miss cross-module guards such as the auth ACL i18n test).
