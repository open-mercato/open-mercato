# Query Index Coverage TTL

## Goal

Fix issue #2353 by using the existing query-index coverage snapshot TTL so custom-field list requests do not synchronously recompute coverage counts on every hot-path request.

## Scope

- Update `packages/core/src/modules/query_index/lib/engine.ts` so stored coverage snapshots are read first and refreshed only when missing or older than `QUERY_INDEX_COVERAGE_CACHE_MS`.
- Keep the existing `OPTIMIZE_INDEX_COVERAGE_STATS` async refresh behavior compatible.
- Update `packages/core/src/modules/query_index/lib/coverage.ts` so independent count queries run concurrently during refresh.
- Add focused regression tests in `packages/core/src/modules/query_index/__tests__/hybrid-engine.test.ts`.

## Non-goals

- Do not change public query engine types, API response shapes, event IDs, route URLs, ACL IDs, or DB schema.
- Do not change custom-field query semantics or partial-coverage fallback behavior.
- Do not introduce a new cache backend, production dependency, or migration.
- Do not implement request micro-batching beyond parallelizing independent count queries inside `refreshCoverageSnapshot`.

## Implementation Plan

### Phase 1: Coverage TTL Gate

Read the stored `entity_index_coverage` snapshot before any refresh. If the snapshot is fresh within `coverageStatsTtlMs`, return it directly. If it is absent or stale, refresh once synchronously and then read the updated snapshot. When `OPTIMIZE_INDEX_COVERAGE_STATS=true`, preserve async refresh behavior by scheduling refresh for missing or stale snapshots and serving the last-known snapshot.

### Phase 2: Refresh Count Parallelism

Run the base-table, `entity_indexes`, and vector count branches concurrently where possible after required column metadata checks have completed.

### Phase 3: Tests And Validation

Add tests proving fresh snapshots skip `refreshCoverageSnapshot`, stale snapshots trigger it, optimized mode serves stale data while scheduling async refresh, and run focused validation for `@open-mercato/core`.

## Risks

- Coverage data can be stale within the configured TTL. This is already the intent of the dormant TTL field and is acceptable because query-index coverage is an approximate freshness guard.
- `OPTIMIZE_INDEX_COVERAGE_STATS` behavior must remain fail-open and non-blocking for async refresh scheduling.
- Parallel count execution must not change scoping filters or with-deleted handling.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Coverage TTL Gate

- [ ] 1.1 Gate coverage refresh by stored snapshot TTL

### Phase 2: Refresh Count Parallelism

- [ ] 2.1 Parallelize independent coverage count queries

### Phase 3: Tests And Validation

- [ ] 3.1 Add focused query_index regression tests
- [ ] 3.2 Run validation and self-review
- [ ] 3.3 Push branch and open PR
