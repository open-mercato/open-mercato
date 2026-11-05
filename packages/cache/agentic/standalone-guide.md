# Cache Package — Standalone Developer Guide

`@open-mercato/cache` provides tenant-scoped caching with tag-based invalidation. MUST NOT use raw Redis, SQLite, or in-memory caching directly.

## Strategy Selection

| Strategy | When | Config |
|----------|------|--------|
| Memory | Development, single-process | Default (no config) |
| SQLite | Single-server production | `CACHE_STRATEGY=sqlite` |
| Redis | Multi-server, shared cache | `CACHE_STRATEGY=redis` |

## Usage

Always resolve via DI:

```typescript
const cacheService = container.resolve('cacheService')

// Set with tags for targeted invalidation
await cacheService.set(`${tenantId}:my_module:stats`, value, {
  tags: [`tenant:${tenantId}`, 'my_module'],
})

// Get
const cached = await cacheService.get(`${tenantId}:my_module:stats`)

// Invalidate by tag (clears all entries with that tag)
await cacheService.invalidateTag('my_module')
```

## MUST Rules

1. **MUST resolve via DI** — `container.resolve('cacheService')`, never instantiate directly
2. **MUST scope to tenant** — include `tenantId` in cache keys
3. **MUST use tag-based invalidation** for CRUD side effects
4. **MUST NOT cache sensitive data** without encryption

## Adding Cache to a Module

1. Resolve `cacheService` from DI in your service or route handler
2. Define cache keys: `${tenantId}:${module}:${identifier}`
3. Tag entries: `{ tags: ['tenant:123', 'my_module'] }`
4. Add cache invalidation to CRUD side effects (`emitCrudSideEffects` with `cacheAliases`)
5. Test with `CACHE_STRATEGY=memory` (default in dev)
