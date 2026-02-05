# Cache Package — Agent Guidelines

`@open-mercato/cache` provides multi-strategy caching with tag-based invalidation.

## Structure

```
packages/cache/src/
├── strategies/    # Redis, SQLite, memory implementations
└── __tests__/
```

## Strategies

| Strategy | Best For | Configuration |
|----------|----------|---------------|
| Memory | Development, single-process | Default |
| SQLite | Single-server production | `CACHE_STRATEGY=sqlite` |
| Redis | Multi-server production | `CACHE_STRATEGY=redis` |

## Tag-Based Invalidation

Cache entries can be tagged. Invalidating a tag clears all entries with that tag. This is used for tenant-scoped cache busting and CRUD side effects.

## Tenant Scoping

All cache operations should be tenant-scoped. Include `tenantId` in cache keys or use the built-in scoping utilities.

## Usage

Cache is injected via DI (`container.resolve('cacheService')`). Do not instantiate directly.
