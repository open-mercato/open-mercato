# @open-mercato/cache

> Tag-aware, strategy-pluggable cache service extracted from the Open Mercato platform—now packaged for general-purpose Node.js apps.

- 🔁 **Swappable storage engines**: in-memory, Redis, SQLite, or JSON-file without touching your call-sites.
- 🏷️ **Tag-based invalidation**: expire related keys with one operation (`deleteByTags`).
- ⏱️ **TTL + stats tooling**: per-entry TTLs, wildcard key lookups, stats, and cleanup helpers.
- 🧩 **DI friendly**: use the functional factory or the `CacheService` class.
- 🧾 **Pure TypeScript**: strict typings + generated declaration files (emitted to `dist/`).
- 🪶 **Zero hard deps**: optional peers (`ioredis`, `better-sqlite3`) only when you activate those strategies.

---

## Installation

```bash
yarn add @open-mercato/cache

# add peers when needed
yarn add ioredis           # for the Redis strategy
yarn add better-sqlite3    # for the SQLite strategy
```

> Runtime: Node 18+. The library is compiled with the repo’s root `tsconfig` and ships JS + d.ts files in `dist/`.

---

## Quick start

```ts
import { createCacheService } from '@open-mercato/cache'

const cache = createCacheService({
  strategy: process.env.CACHE_STRATEGY || 'memory',
  redisUrl: process.env.CACHE_REDIS_URL,
  sqlitePath: './data/cache.db',
  jsonFilePath: './data/cache.json',
  defaultTtl: 5 * 60_000,
})

await cache.set('user:123', { name: 'Ada' }, { ttl: 10 * 60_000, tags: ['users', 'user:123'] })

const result = await cache.get('user:123')
await cache.deleteByTags(['users']) // bust related entries
await cache.cleanup()               // sweep expired rows (mainly for sqlite/json)
await cache.close()                 // dispose connections on shutdown
```

---

## Strategy matrix

| Strategy   | Persistence | Concurrency | Extra deps       | Typical use case                               |
|------------|-------------|-------------|------------------|------------------------------------------------|
| `memory`   | ❌ process   | single node | –                | Unit tests, light CLIs, temporary caches       |
| `redis`    | ✅ external  | multi-node  | `ioredis`        | Horizontal APIs, queues, distributed workers   |
| `sqlite`   | ✅ local     | single node | `better-sqlite3` | Edge workers, self-hosted admin tooling        |
| `jsonfile` | ✅ local     | single node | –                | Debugging snapshots, very small deployments    |

Switch the strategy via:

- `CACHE_STRATEGY` env var (`memory` default), or
- Passing `strategy`, `redisUrl`, `sqlitePath`, `jsonFilePath` to `createCacheService`.

---

## Configuration

### Environment variables

```bash
CACHE_STRATEGY=memory|redis|sqlite|jsonfile
CACHE_TTL=300000
CACHE_REDIS_URL=redis://localhost:6379
CACHE_SQLITE_PATH=.cache/cache.db
CACHE_JSON_FILE_PATH=.cache/cache.json
```

### Programmatic

```ts
const sqliteCache = createCacheService({
  strategy: 'sqlite',
  sqlitePath: './data/cache.db',
  defaultTtl: 30 * 60_000,
})
```

---

## API reference (all strategies implement these)

| Method | Description |
|--------|-------------|
| `get(key, { returnExpired? })` | Retrieves a value, optionally returning expired records for debugging. |
| `set(key, value, { ttl?, tags? })` | Stores a value with a TTL and tag metadata. |
| `has(key)` | Boolean existence check (ignores expired rows). |
| `delete(key)` | Removes a single key. |
| `deleteByTags(tags[])` | Removes every entry that matches _any_ of the provided tags. |
| `clear()` | Clears the current scope (all tenant-prefixed entries when used inside Open Mercato). |
| `keys(pattern?)` | Lists logical keys using glob syntax (`*`, `?`). |
| `stats()` | Returns `{ size, expired }` counters. |
| `cleanup()` | Sweeps expired entries (primarily for sqlite/json backends). |
| `close()` | Disposes the underlying client (important for Redis). |

Prefer the functional factory (`createCacheService`) for most cases. If you need to integrate with Awilix or another DI container, use the `CacheService` class wrapper—its public methods mirror the table above.

---

## Advanced usage

### Tag-based invalidation

```ts
await cache.set(`product:${id}`, payload, {
  tags: ['products', `catalog:${catalogId}`, `product:${id}`],
})

// Later…
await cache.deleteByTags([`catalog:${catalogId}`]) // bust only that catalog
```

Tags behave like sets. A single delete request can invalidate thousands of keys without scanning the entire store, which keeps admin actions and background jobs snappy.

### Pattern matching & diagnostics

```ts
const staleKeys = await cache.keys('report:*:2024-*')
const stats = await cache.stats()

console.log(`Cache size: ${stats.size}, expired entries waiting: ${stats.expired}`)
```

The glob-matching happens on logical keys, so you can keep friendly names for troubleshooting while the implementation hashes/filters keys under the hood.

---

## Building & publishing

This package lives inside the monorepo but publishes independently. The emitted JS and declaration files live in `dist/` (ignored by git).

```bash
# Install dependencies at the repo root
yarn install

# Build the cache package
npx tsc -p packages/cache/tsconfig.build.json

# Run the targeted test suite (optional)
npm run test -- --runTestsByPath packages/cache/src/__tests__/service.test.ts

# Inspect the tarball before publishing
cd packages/cache
npm pack

# Publish
npm publish --access public
```

The `package.json` already points `main`/`types` at `dist/index.*`, so consumers always receive compiled artifacts.

---

## Contributing

1. Edit the TypeScript sources in `packages/cache/src`.
2. Run the focused Jest suite (`npm run test -- --runTestsByPath packages/cache/src/__tests__/service.test.ts`).
3. Rebuild (`npx tsc -p packages/cache/tsconfig.build.json`) to refresh `dist/`.
4. Open a PR and describe the strategy/feature you touched.

Bug reports & feature requests: open an issue in the main Open Mercato repository and tag it with `cache`.

---

## License

MIT © Open Mercato
