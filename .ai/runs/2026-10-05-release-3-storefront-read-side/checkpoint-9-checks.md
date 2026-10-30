# Checkpoint 9 — Phase 4 close (Storefront Public API Phase 1 gate + release ACCEPTANCE)

**Timestamp:** 2026-10-06T11:20:52Z
**Steps covered:** 4.5-fix–4.9 (ae40653ccf .. 230e652b1e)
**Runner:** local mode (`LANG=en_US.UTF-8`) for unit/typecheck; ephemeral env (fresh build, own DB) for integration
**Touched areas:** catalog pricing D2a promotion overlay; ecommerce listing (`storefrontQuery`, `storefrontProducts`), detail (`storefrontDetail`, per-variant tiers), `storefrontCatalogSupport`, translations `batchLoadTranslationsMany`, public `/products` + `/products/[idOrHandle]` routes with digest-keyed storefront cache, catalog/availability invalidation subscribers; TC-ECOM-010..013.

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ | |
| typecheck core + shared (--force) | ✅ | |
| `yarn workspace @open-mercato/core test` (FULL) | ✅ 19551 passed | |
| `yarn workspace @open-mercato/shared test` (FULL) | ✅ 2641 passed | |
| `yarn i18n:check-sync` | ✅ | |
| `yarn test:integration TC-ECOM-01` (ephemeral) | ✅ 9/9 | ACCEPTANCE: same product URL anonymous 123 gross vs B2B 80 net; out-of-group-scope product 404 for B2B only; interleaved anon/B2B listing + detail never mix (no cache bleed); Cache-Control per auth state; personal contract row wins for that customer only; identical 404 for restricted/inactive/deleted/other-tenant/nonexistent by handle and id; second tenant never sees first tenant's products; grammar 400s; locale fallback; ILIKE within scope; page-scoped availability; promotion presented only with an Omnibus reference in an EU-enabled channel |
| `yarn test:integration TC-ECOM-00` (regression) | ✅ 12/12 | |

**Gates:** Storefront Public API Phase 1 gate ✅ (isolation suite, enumeration oracle; query budgets asserted at unit level: list ≤ 13, detail ≤ 10 with categories — spec §10 sync item). **Release ACCEPTANCE ✅.**
