# Checkpoint 4 — Phase 2 close (SPEC-029 Phase 1 gate)

**Timestamp:** 2026-10-05T13:27:32Z
**Steps covered:** 2.10–2.11 (56a708e730 .. c0ef621f3d)
**Runner:** local mode for unit/typecheck; integration suite in the ephemeral environment (`yarn test:integration:ephemeral:start`, own containers + DB at http://127.0.0.1:5001 — local DB untouched)
**Touched areas:** ecommerce `search.ts`, lazy portal-auth import + import-graph guard, `__integration__` TC-ECOM-001..004.

| Check | Result | Notes |
|---|---|---|
| `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/shared --force` | ✅ pass | |
| `yarn workspace @open-mercato/core test src/modules/ecommerce src/__tests__` | ✅ pass | 41 suites, 429 tests |
| `yarn workspace @open-mercato/search test global-search-acl` | ✅ pass | 23 tests |
| `yarn i18n:check-sync` | ✅ pass | |
| Ephemeral env start | ❌ → ✅ | (1) core dist lacked ecommerce → rebuilt packages; (2) `di.ts → buyerContext → customerAuth → next/server` crashed non-Next processes → 2.10-fix; (3) placeholder `JWT_SECRET` refused in production mode → started with a throwaway random secret via env var (not persisted) |
| `BASE_URL=http://127.0.0.1:5001 DATABASE_URL=<ephemeral> yarn test:integration TC-ECOM-00 --retries=0` | ✅ 12/12 | resolution (active-only, identical 404s, 410, 503, storeSlug 400, locale), buyer context (channel vs group price-kind taxMode, 401 on foreign-tenant token), cache isolation (anon after auth, two buyers interleaved), admin API tenant isolation |
| UI verification | ⏭️ skipped | no UI yet |

**SPEC-029 Phase 1 gate:** cache-isolation suite passes ✅; anonymous vs authenticated B2B contexts differ correctly ✅; resolution P95 budget — ⏭️ not measured (no perf fixture yet; carried to final gate).
