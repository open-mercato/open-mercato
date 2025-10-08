# @open-mercato/cache

Multi-strategy cache service with tag-based invalidation support for Open Mercato.

## Features

- **Multiple Storage Strategies**: Memory, Redis, SQLite, JSON File
- **Tag-Based Invalidation**: Group cache entries by tags and invalidate them all at once
- **TTL Support**: Set time-to-live for cache entries
- **Pattern Matching**: Find keys using wildcard patterns
- **ENV Configuration**: Configure strategy via environment variables
- **TypeScript**: Fully typed with TypeScript
- **Zero Dependencies**: Core package has no dependencies (peer deps for Redis and SQLite are optional)

## Installation

```bash
yarn add @open-mercato/cache
```

### Optional Dependencies

Depending on your chosen strategy, you may need to install additional dependencies:

```bash
# For Redis strategy
yarn add ioredis

# For SQLite strategy
yarn add better-sqlite3
```

## Quick Start

```typescript
import { createCacheService } from '@open-mercato/cache'

// Create a cache service (defaults to memory strategy)
const cache = createCacheService()

// Set a value with tags
await cache.set('user:123', { name: 'John Doe', email: 'john@example.com' }, {
  ttl: 60000, // 1 minute
  tags: ['users', 'user:123']
})

// Get a value
const user = await cache.get('user:123')

// Invalidate all cache entries with specific tags
await cache.deleteByTags(['users']) // Clears all user-related cache

// Check if a key exists
const exists = await cache.has('user:123')

// Delete a specific key
await cache.delete('user:123')

// Get all keys matching a pattern
const keys = await cache.keys('user:*')

// Clear all cache
await cache.clear()

// Get cache statistics
const stats = await cache.stats()
console.log(`Cache size: ${stats.size}, Expired: ${stats.expired}`)

// Cleanup expired entries
await cache.cleanup()
```

## Configuration

### Environment Variables

```bash
# Cache strategy (default: memory)
CACHE_STRATEGY=memory|redis|sqlite|jsonfile

# Default TTL in milliseconds (optional)
CACHE_TTL=300000

# Redis configuration (for redis strategy)
CACHE_REDIS_URL=redis://localhost:6379

# SQLite configuration (for sqlite strategy)
CACHE_SQLITE_PATH=.cache.db

# JSON file configuration (for jsonfile strategy)
CACHE_JSON_FILE_PATH=.cache.json
```

### Programmatic Configuration

```typescript
import { createCacheService } from '@open-mercato/cache'

// Memory strategy (default)
const memoryCache = createCacheService({
  strategy: 'memory',
  defaultTtl: 60000 // 1 minute
})

// Redis strategy
const redisCache = createCacheService({
  strategy: 'redis',
  redisUrl: 'redis://localhost:6379',
  defaultTtl: 300000 // 5 minutes
})

// SQLite strategy
const sqliteCache = createCacheService({
  strategy: 'sqlite',
  sqlitePath: './data/.cache.db',
  defaultTtl: 3600000 // 1 hour
})

// JSON File strategy
const fileCache = createCacheService({
  strategy: 'jsonfile',
  jsonFilePath: './data/.cache.json',
  defaultTtl: 600000 // 10 minutes
})
```

## Storage Strategies

### Memory Strategy

Fast in-memory caching. Data is lost when the process restarts.

**Use when:**
- You need maximum performance
- Cache data can be rebuilt on restart
- Running a single instance

**Pros:**
- Fastest performance
- No external dependencies
- No I/O overhead

**Cons:**
- Data lost on restart
- Not shared across instances
- Memory usage

### Redis Strategy

Persistent caching using Redis. Data can be shared across multiple instances.

**Use when:**
- Running multiple instances
- Need persistence across restarts
- Already using Redis

**Pros:**
- Shared across instances
- Persistent
- Battle-tested

**Cons:**
- Requires Redis server
- Network overhead
- Additional dependency

**Dependencies:** `ioredis`

### SQLite Strategy

Persistent caching using SQLite database. Good balance between persistence and simplicity.

**Use when:**
- Need persistence without external server
- Single instance or low concurrency
- File-based storage is acceptable

**Pros:**
- Persistent
- No external server needed
- Good query performance

**Cons:**
- File I/O overhead
- Not suitable for high concurrency
- Requires better-sqlite3

**Dependencies:** `better-sqlite3`

### JSON File Strategy

Simple file-based caching using JSON. Easy to debug and no dependencies.

**Use when:**
- Development/testing
- Low cache frequency
- Human-readable cache is useful

**Pros:**
- No dependencies
- Human-readable
- Easy to debug

**Cons:**
- Slowest performance
- Not suitable for production
- Full file rewrite on changes

## Tag-Based Invalidation

Tags allow you to group related cache entries and invalidate them all at once.

```typescript
// Cache user data with tags
await cache.set('user:123', userData, {
  tags: ['users', 'user:123', 'org:456']
})

await cache.set('user:124', otherUserData, {
  tags: ['users', 'user:124', 'org:456']
})

// Invalidate all users in organization 456
await cache.deleteByTags(['org:456'])

// Invalidate specific user across all their cache entries
await cache.deleteByTags(['user:123'])

// Invalidate all users
await cache.deleteByTags(['users'])
```

## API Reference

### `createCacheService(options?)`

Creates a cache service with the specified options.

**Options:**
- `strategy?: 'memory' | 'redis' | 'sqlite' | 'jsonfile'` - Cache strategy (default: 'memory' or from CACHE_STRATEGY env)
- `defaultTtl?: number` - Default TTL in milliseconds (optional)
- `redisUrl?: string` - Redis connection URL (for redis strategy)
- `sqlitePath?: string` - SQLite database file path (for sqlite strategy)
- `jsonFilePath?: string` - JSON file path (for jsonfile strategy)

### `cache.get(key, options?)`

Get a value from cache.

**Parameters:**
- `key: string` - Cache key
- `options?: { returnExpired?: boolean }` - Get options

**Returns:** `Promise<any | null>` - The cached value or null if not found

### `cache.set(key, value, options?)`

Set a value in cache.

**Parameters:**
- `key: string` - Cache key
- `value: any` - Value to cache
- `options?: { ttl?: number, tags?: string[] }` - Cache options

**Returns:** `Promise<void>`

### `cache.has(key)`

Check if a key exists in cache (and is not expired).

**Returns:** `Promise<boolean>`

### `cache.delete(key)`

Delete a specific key from cache.

**Returns:** `Promise<boolean>` - true if key was deleted

### `cache.deleteByTags(tags)`

Delete all keys with specified tags.

**Parameters:**
- `tags: string[]` - Tags to match (any key with ANY of these tags will be deleted)

**Returns:** `Promise<number>` - Number of keys deleted

### `cache.clear()`

Clear all cache entries.

**Returns:** `Promise<number>` - Number of keys deleted

### `cache.keys(pattern?)`

Get all keys matching a pattern.

**Parameters:**
- `pattern?: string` - Pattern to match (supports wildcards: * and ?)

**Returns:** `Promise<string[]>` - Array of matching keys

### `cache.stats()`

Get cache statistics.

**Returns:** `Promise<{ size: number, expired: number }>`

### `cache.cleanup()`

Clean up expired entries.

**Returns:** `Promise<number>` - Number of entries removed

### `cache.close()`

Close/disconnect the cache strategy.

**Returns:** `Promise<void>`

## DI Integration

The cache service can be easily integrated with dependency injection containers:

```typescript
import { asClass } from 'awilix'
import { CacheService } from '@open-mercato/cache'

// In your DI registration file
container.register({
  cache: asClass(CacheService).singleton()
})

// In your service
class UserService {
  constructor(private cache: CacheService) {}

  async getUser(id: string) {
    const cached = await this.cache.get(`user:${id}`)
    if (cached) return cached

    const user = await this.fetchUserFromDb(id)
    await this.cache.set(`user:${id}`, user, {
      ttl: 300000, // 5 minutes
      tags: ['users', `user:${id}`]
    })

    return user
  }

  async invalidateUser(id: string) {
    await this.cache.deleteByTags([`user:${id}`])
  }
}
```

## Testing

The package includes comprehensive unit tests for all strategies:

```bash
yarn test
```

## License

MIT

