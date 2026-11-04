# Checkpoint 12 — Phase 6 close (Storefront Public API Phases 2–3 gates)

**Timestamp:** 2026-10-06T15:41:11Z
**Steps covered:** 6.6 (8250cfd419); Phase 6 overall 6.1–6.6 + 6.1-fix (44e3bc656a .. 8250cfd419)
**Runner:** local mode (`LANG=en_US.UTF-8`) for build/typecheck/unit; ephemeral env (fresh forced build incl. 8250cfd419, own DB, started 15:27Z) for integration
**Touched areas:** TC-ECOM-014..017 + fixture helpers; fix in `ecommerce/lib/storeContext.ts` (`isStorefrontResolutionError` → `Symbol.for` marker).

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` | ✅ | |
| typecheck core | ✅ | |
| `yarn workspace @open-mercato/core test` (FULL) | ✅ 19734 passed | |
| `yarn test:integration TC-ECOM-` (ephemeral, all storefront suites) | ✅ 32/32 | TC-ECOM-001..005 15/15 · TC-ECOM-010..013 9/9 · TC-ECOM-014 facets 2/2 · 015 categories 3/3 · 016 search 2/2 · 017 rate-limit default 1/1 |

**Defect found by 6.6 and fixed in the same Step:** on the env built before the fix, TC-ECOM-00 failed 5/15 — every store-resolution error (unknown host 404, archived 410, no channel 503, `storeSlug` 400, foreign-tenant portal token 401) answered **500**. `isStorefrontResolutionError` used `instanceof`, but `storeContextService` comes from DI registrars that can load from another bundle layer than the route (load-order dependent — it passed at checkpoint 10). Now a `Symbol.for` marker (same approach as `CrudHttpError`), unit-tested with a second module copy; verified 15/15 on the rebuilt env.

**Coverage limits (stated, not hidden):**
- Search: `tokens` (single-word) and `ILIKE` (2-char) exercised on a real DB, incl. the starvation case on `tokens` (restricted buyer still gets a full page of in-assortment results) and payload parity. `pgvector` not exercised — no embedding provider configured in the env; unit-level only.
- Rate limits: 429 unreachable in the env (`OM_INTEGRATION_TEST=true` disables the limiter; no `RATE_LIMIT_TRUST_PROXY_DEPTH`). TC-ECOM-017 asserts the default (130-request burst served); 429 body/headers/`ip:storeId` keying/fail-open are unit-tested only.

**Gate:** Storefront Public API Phases 2–3 ✅ (within the limits above).
**UI:** not touched in 6.6.
