# Checkpoint 2 — Phase 2 (tenant-scoped search settings + env defaults)

**UTC:** 2026-06-17T14:55:00Z
**Steps covered:** 2.1 → 2.3 (commits 3dffd2203 / e00a1cbc8 / 1b1c4f25b; pushed head a760e0310)
**Packages touched:** `@open-mercato/search` (`modules/search/lib/*`, `modules/search/api/*`)

## Checks

| Check | Scope | Result |
|-------|-------|--------|
| Compile — `yarn workspace @open-mercato/search build` | search | ✅ built successfully (exit 0), 88 entry points |
| Unit — search lib tests | `modules/search/lib/__tests__` | ✅ 7/7 pass (incl. new search-settings-scope 3/3) |
| Playwright — `TC-SEARCH-010` | API source/round-trip | ⏳ runs in final gate `yarn test:integration` (needs ephemeral stack) |
| UI / Playwright local | — | N/A — Phase 2 touches no UI |

## Scope decisions (documented for reviewer)

- Settings **management** surface (embeddings GET/POST, global-search GET/POST) is tenant-scoped via `auth.tenantId`.
- Cmd+K **query** route (`api/search/global`) reads global-search strategies tenant-scoped so a tenant's selection takes effect at query time.
- Embedding-config **consumers** that drive the shared pgvector table (vector-index worker, vector_upsert/delete/purge subscribers, reindex + query embedding reconfigure) intentionally remain **instance-level**: the vector table has a single global dimension (POST recreates it globally), so indexing and querying must agree on one embedding config. Per-tenant *storage* gives UI isolation + clobber-fix; per-tenant *vectors* is a non-goal.

## BC

- All helper signatures gained an optional `scope`/options argument; existing callers (workers/subscribers/query) that omit it keep reading the global/instance row. Response additions (`source`, `embeddingConfigSource`) are additive.
