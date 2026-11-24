# Cache Package — Agent Guidelines

Use `@open-mercato/cache` for all caching needs. MUST NOT use raw Redis, SQLite, or in-memory caching directly.

## Strategy Selection

| Strategy | When to use | Configuration |
|----------|-------------|---------------|
| Memory | Use for development and single-process apps | Default (no config needed) |
| SQLite | Use for single-server production deployments; local persistent convenience cache, tuned with WAL/`synchronous=NORMAL` | `CACHE_STRATEGY=sqlite` |
| Redis | Use for multi-server production or latency-sensitive request paths with frequent cache writes | `CACHE_STRATEGY=redis` |

The `memory` strategy is per process: a write on one instance never invalidates another instance's copy inline. A module relying on tag-based invalidation for correctness across multiple instances (e.g. the webhooks package's subscription cache, `OM_WEBHOOKS_SUBSCRIPTION_CACHE_TTL_MS`) needs `CACHE_STRATEGY=redis`, or a short TTL as a fallback, to converge promptly.

## Memory Strategy Bounds

Bounded so a process-shared instance (`OM_BOOTSTRAP_CACHE`, workers, CRUD list cache) cannot grow with user-controlled key cardinality.

- **LRU cap** — `maxEntries` (default `50000`); reads refresh recency, writes evict the LRU entries past the cap. Override with `CACHE_MEMORY_MAX_ENTRIES` (commented in `.env.example`); a non-positive value disables the cap (**unbounded** — per-request instances only); an unparseable one is ignored.
- **Amortized sweep** — every 256 writes a budgeted `O(budget)` pass from the LRU head reclaims expired entries (no timer); the rest go on access, eviction or `cleanup()`.
- **Observability** — memory-backed `stats()` adds process-global `evictions`, `sweeps`, `lastSweepReclaimed` next to tenant-scoped `size`/`expired`; other backends omit them.

## Value Compression

The redis and sqlite strategies can compress serialized entries (`packages/cache/src/codec.ts`); memory and jsonfile never do.

- **`CACHE_COMPRESSION`** — `off` (default) | `zstd` (level 1; falls back to `gzip` with one warning when the runtime lacks zstd) | `gzip` (level 6).
- **`CACHE_COMPRESSION_MIN_BYTES`** — smaller entries (default `1024`) stay plain JSON; compressed form kept only when smaller.
- **Reads detect the format by magic bytes**, so JSON, zstd and gzip entries coexist across setting changes. Decompression capped at 64 MiB; a corrupt frame is a miss.
- **Enable** for remote or memory-bound Redis; on localhost Redis/SQLite it only saves memory/disk at a small read cost.
- **Rollout:** enable only once every instance supports the codec; set `off` before rolling back (older versions drop compressed entries as misses).

## Pluggable providers

An npm package can replace the stock strategies deployment-wide. Docs: `apps/docs/docs/architecture/cache-providers.mdx`.

- **Contract** — server-only `@open-mercato/cache/provider`: `defineCacheProvider` (id `<scope>/<name>`, `safeParse` settings schema, `capability()` → `placement: 'shared' | 'local'`, `create()` → base `CacheStrategy` with required `healthcheck` + `close`), `defineCacheProviderRegistration`, `CacheProviderError` (stable `code`, sanitized message).
- **Selection** — app-root `mercato.cache.ts` exports `cacheProviders` (`yarn generate` re-exports it). `CACHE_PROVIDER=<id>` beats `CACHE_STRATEGY`; explicit `strategy` option beats both; `CACHE_PROVIDER_NAMESPACE` required.
- **MUST NOT fall back to memory** for a provider — rethrow `isCacheProviderError` errors from bootstrap catches. Providers always use the process singleton.
- Use `describeCacheSelection()`, not `CACHE_STRATEGY`, for readiness, the multi-instance guard and placement warnings.
- **Provider rules** — keys/tags arrive tenant-scoped; fence by `context.namespace`; `helpers.decode` throws → miss; `deleteByTags`/`cleanup`/`clear` count physical records; apply `context.defaultTtl`.
- **Verify** with `defineCacheProviderConformance` (`@open-mercato/cache/testing`); reference `fixtures/cache-provider-fixture` + `src/__tests__/provider-fixture.packed.test.ts`.

## Always

1. **MUST resolve via DI** — always use `container.resolve('cache')`, never instantiate cache directly. The DI token is `cache` (registered in `packages/core/src/bootstrap.ts`); there is no `cacheService` registration.
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
const cache = container.resolve('cache')

// When caching, attach tags
await cache.set('key', value, { tags: ['tenant:123', 'customers'] })

// When data changes, invalidate by tag — `deleteByTags` takes an ARRAY of tags
// (any entry carrying ANY of them is dropped) and returns the number of deleted keys.
await cache.deleteByTags(['customers'])  // Clears all customer-related cache
```

`CacheStrategy` is the only cache surface: `get`, `set`, `has`, `delete`, `deleteByTags`, `clear`, `keys`, `stats`, plus optional `healthcheck`, `cleanup`, `close`. There is no `invalidateTag` — MUST NOT invent per-tag helpers in module code.

## Consistency vs commit timing

Cache invalidation and query-index side effects (`emitCrudSideEffects`) MUST fire **after** the domain write commits, OUTSIDE `withAtomicFlush` (see `packages/core/AGENTS.md`). The read-projection tail (search tokens, vectors, fulltext, coverage) converges asynchronously, so reads may briefly lag a write.

Opt-in `OM_CACHE_SAFETY_ALWAYS_CONSISTENT` (default **OFF**) makes that tail converge synchronously and propagates index-write failures, at added write latency; it does not move side effects into the transaction. See `.ai/specs/2026-06-05-cache-safety-always-consistent.md`.

## Adding Caching to a Module

1. Resolve the `cache` service from DI (`container.resolve('cache')`) in your service or route handler
2. Define cache keys with tenant scoping: `${tenantId}:${module}:${identifier}`
3. Tag entries with entity type and tenant for targeted invalidation
4. Add cache invalidation to CRUD side effects (`emitCrudSideEffects` with `cacheAliases`)
5. Test with `CACHE_STRATEGY=memory` (default in dev)

## Structure

`src/strategies/` (stock backends), `src/provider.ts` (provider contract), `src/testing/` (conformance kit), `fixtures/` (packed provider fixture).

## When Modifying This Package

- Follow the strategy pattern — new strategies go in `strategies/` with the same interface
- Run `yarn test` in `packages/cache`; verify tag invalidation across all strategies when touching invalidation
- `src/__tests__/cache-di-contract-docs.test.ts` pins the DI token and method names quoted here and in `.ai/review-checklist.md`; renaming either MUST update both docs.
