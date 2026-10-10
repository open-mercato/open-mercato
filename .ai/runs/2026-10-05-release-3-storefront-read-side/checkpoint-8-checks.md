# Checkpoint 8 — Phase 4 (part 1: filters, scope_keys, scope builder, pricing)

**Timestamp:** 2026-10-06T09:35:38Z
**Steps covered:** 4.1–4.5 (c8286520e8 .. 23f14ceba7)
**Runner:** local mode, `LANG=en_US.UTF-8`
**Touched areas:** catalog `lib/productFilters.ts` (extraction + BC re-export, descendant expansion); query_index doc-enricher hook; shared query engine `overlap`/`noverlap` ops (+ UPGRADE_NOTES); catalog `scope_keys` enricher, GIN index migration (query_index), category re-parent/delete reindex subscribers; ecommerce `storefrontProductScope.ts`, `storefrontPricing.ts`.

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | |
| `yarn turbo run typecheck --filter=@open-mercato/{core,shared} --force` | ✅ pass | |
| `yarn workspace @open-mercato/core test` (FULL) | ✅ 19420 passed | 0 failed |
| `yarn workspace @open-mercato/shared test` (FULL) | ✅ 2641 passed | |
| `yarn i18n:check-sync` | ✅ pass | |
| scope ↔ matchesScope equivalence | ✅ 20 000 seeded cases (4.4) | |
| UI / integration | ⏭️ | no UI; Public API integration suite is Step 4.9 |
