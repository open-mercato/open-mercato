# Cache Package — Agent Guidelines

Use `@open-mercato/cache` for all caching needs. MUST NOT use raw Redis, SQLite, or in-memory caching directly.

## Strategy Selection

| Strategy | When to use | Configuration |
|----------|-------------|---------------|
| Memory | Use for development and single-process apps | Default (no config needed) |
| SQLite | Use for single-server production deployments; local persistent convenience cache, tuned with WAL/`synchronous=NORMAL` | `CACHE_STRATEGY=sqlite` |
| Redis | Use for multi-server production or latency-sensitive request paths with frequent cache writes | `CACHE_STRATEGY=redis` |

## Memory Strategy Bounds

The memory strategy is bounded so a process-shared instance (`OM_BOOTSTRAP_CACHE`, long-lived workers, memory-backed CRUD list cache) cannot grow without limit on user-controllable key cardinality.

- **LRU cap** — at most `maxEntries` entries are retained (default `50000`). Reads refresh recency (Map re-insertion); the least-recently-used entries are evicted on write once the cap is exceeded.
- **`CACHE_MEMORY_MAX_ENTRIES`** — env override for the cap, resolved in the cache service. `.env.example` carries a commented `#CACHE_MEMORY_MAX_ENTRIES=50000`. A non-positive value (or an unparseable one — which is ignored, falling back to the default) disables the cap (**unbounded** — only safe for short-lived per-request instances).
- **Amortized expired-entry sweep** — expired entries are reclaimed by a budgeted sweep that runs every 256 writes (no per-instance timer, so the per-request default stays leak-free). Each pass scans a bounded slice from the LRU head, so it stays `O(budget)` rather than scanning the whole store. Expired entries beyond the budget are still reclaimed on access, by LRU eviction, or via an explicit `cleanup()`.
- **Observability** — `stats()` on a memory-backed service surfaces `evictions`, `sweeps`, and `lastSweepReclaimed` (process-global counters) alongside the tenant-scoped `size`/`expired`, so operators can tell whether the bound is actively protecting the process. Other backends omit these fields.

## Always

1. **MUST resolve via DI** — always use `container.resolve('cacheService')`, never instantiate cache directly
2. **MUST scope to tenant** — include `tenantId` in cache keys or use `runWithCacheTenant()` for automatic scoping
3. **MUST use tag-based invalidation** for CRUD side effects — tag entries so related data can be invalidated together

## Ask First

- Ask before adding a new cache backend, changing default strategy selection, or caching data whose sensitivity is unclear.
- Ask before changing invalidation semantics that could affect multiple modules or tenants.

## Never

- Never instantiate cache clients directly; all cache access goes through the cache service abstraction.
- Never use raw Redis or SQLite clients from module code.
- Never cache sensitive data (passwords, tokens, PII) without encryption.

## Validation Commands

```bash
yarn workspace @open-mercato/cache test
yarn workspace @open-mercato/cache build
```

## Tag-Based Invalidation

Use tags when cached data relates to a specific entity or scope. Invalidating a tag clears all entries with that tag.

```typescript
// When caching, attach tags
await cacheService.set('key', value, { tags: ['tenant:123', 'customers'] })

// When data changes, invalidate by tag
await cacheService.invalidateTag('customers')  // Clears all customer-related cache
```

## Consistency vs commit timing

Cache invalidation and query-index side effects (`emitCrudSideEffects`) MUST fire **after** the originating domain write commits — the same rule that keeps them OUTSIDE the `withAtomicFlush` block (see `packages/core/AGENTS.md` → "Entity Update Safety — `withAtomicFlush`"). Because invalidation runs post-commit and the query-index read-projection tail (search tokens, vectors, fulltext, coverage) converges asynchronously, reads can briefly see a short convergence window after a write.

The opt-in env flag `OM_CACHE_SAFETY_ALWAYS_CONSISTENT` (default **OFF**, 100% backward compatible) makes that read-projection tail converge synchronously on write and propagates index-write failures instead of swallowing them — at the cost of added write latency. It does not move query-index side effects into the domain-write transaction. See `.ai/specs/2026-06-05-cache-safety-always-consistent.md`.

## Adding Caching to a Module

1. Resolve `cacheService` from DI in your service or route handler
2. Define cache keys with tenant scoping: `${tenantId}:${module}:${identifier}`
3. Tag entries with entity type and tenant for targeted invalidation
4. Add cache invalidation to CRUD side effects (`emitCrudSideEffects` with `cacheAliases`)
5. Test with `CACHE_STRATEGY=memory` (default in dev)

## Structure

```
packages/cache/src/
├── strategies/    # Redis, SQLite, memory implementations
└── __tests__/
```

## When Modifying This Package

- Follow the strategy pattern — add new strategies in `strategies/` with the same interface
- Run `yarn test` in `packages/cache` after changes
- Verify tag invalidation works across all strategies when modifying invalidation logic
