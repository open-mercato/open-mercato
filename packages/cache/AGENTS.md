# Cache Package — Agent Guidelines

Use `@open-mercato/cache` for all caching needs. MUST NOT use raw Redis, SQLite, or in-memory caching directly.

## Strategy Selection

| Strategy | When to use | Configuration |
|----------|-------------|---------------|
| Memory | Use for development and single-process apps | Default (no config needed) |
| SQLite | Use for single-server production deployments | `CACHE_STRATEGY=sqlite` |
| Redis | Use for multi-server production with shared cache | `CACHE_STRATEGY=redis` |

## MUST Rules

1. **MUST resolve via DI** — always use `container.resolve('cacheService')`, never instantiate cache directly
2. **MUST scope to tenant** — include `tenantId` in cache keys or use `runWithCacheTenant()` for automatic scoping
3. **MUST NOT use raw Redis/SQLite clients** — all cache access goes through the cache service abstraction
4. **MUST use tag-based invalidation** for CRUD side effects — tag entries so related data can be invalidated together
5. **MUST NOT cache sensitive data** (passwords, tokens, PII) without encryption

## Tag-Based Invalidation

Use tags when cached data relates to a specific entity or scope. Invalidating a tag clears all entries with that tag.

```typescript
// When caching, attach tags
await cacheService.set('key', value, { tags: ['tenant:123', 'customers'] })

// When data changes, invalidate by tag
await cacheService.invalidateTag('customers')  // Clears all customer-related cache
```

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
