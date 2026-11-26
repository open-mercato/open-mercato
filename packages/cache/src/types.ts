import type { ResolvedCacheProvider } from './provider'

export type { CacheEntry, CacheGetOptions, CacheOptions, CacheSetOptions, CacheStrategy, CacheValue } from '@open-mercato/cache-provider-kit'

export type CacheServiceOptions = {
  strategy?: 'memory' | 'redis' | 'sqlite' | 'jsonfile'
  /**
   * Explicitly resolved npm cache provider (see `@open-mercato/cache/provider`).
   * Takes precedence over the ambient `CACHE_PROVIDER` selection; combining it
   * with an explicit `strategy` is a `conflicting_selection` error.
   */
  provider?: ResolvedCacheProvider
  redisUrl?: string
  sqlitePath?: string
  jsonFilePath?: string
  defaultTtl?: number
  /**
   * Upper bound on retained entries for the in-memory strategy (including the
   * memory fallback used when a native dependency is unavailable). Bounds
   * memory for process-wide instances via LRU eviction. Falls back to
   * `CACHE_MEMORY_MAX_ENTRIES` then a built-in default; a non-positive value
   * disables the cap.
   */
  maxEntries?: number
  /**
   * Value compression for the redis and sqlite strategies. Falls back to
   * `CACHE_COMPRESSION`, then `off`. Reads detect the stored format, so
   * entries written under any setting stay readable.
   */
  compression?: 'off' | 'zstd' | 'gzip'
  /**
   * Smallest serialized entry, in bytes, that gets compressed. Falls back to
   * `CACHE_COMPRESSION_MIN_BYTES`, then 1024.
   */
  compressionMinBytes?: number
}
