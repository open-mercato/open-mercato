import type { CacheStrategy, CacheEntry, CacheGetOptions, CacheSetOptions, CacheValue } from '../types'
import { CacheDependencyUnavailableError } from '../errors'

type RedisPipeline = {
  set(key: string, value: string): RedisPipeline
  setex(key: string, ttlSeconds: number, value: string): RedisPipeline
  sadd(key: string, value: string): RedisPipeline
  srem(key: string, member: string): RedisPipeline
  del(key: string): RedisPipeline
  exec(): Promise<unknown>
}

type RedisClient = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>
  del(key: string): Promise<unknown>
  exists(key: string): Promise<number>
  keys(pattern: string): Promise<string[]>
  smembers(key: string): Promise<string[]>
  pipeline(): RedisPipeline
  quit(): Promise<void>
  once?(event: 'end', listener: () => void): void
}

type RedisConstructor = new (url?: string) => RedisClient
type PossibleRedisModule = unknown

type RequireFn = (id: string) => unknown

/**
 * Redis cache strategy with tag support
 * Persistent across process restarts, can be shared across multiple instances
 * 
 * Uses Redis data structures:
 * - Hash for storing cache entries: cache:{key} -> {value, tags, expiresAt, createdAt}
 * - Sets for tag index: tag:{tag} -> Set of keys
 */
let redisModulePromise: Promise<PossibleRedisModule> | null = null
type RedisRegistryEntry = { client?: RedisClient; creating?: Promise<RedisClient>; refs: number }
const redisRegistry = new Map<string, RedisRegistryEntry>()

function resolveRequire(): RequireFn | null {
  const nonWebpack = (globalThis as { __non_webpack_require__?: unknown }).__non_webpack_require__
  if (typeof nonWebpack === 'function') return nonWebpack as RequireFn
  if (typeof require === 'function') return require as RequireFn
  if (typeof module !== 'undefined' && typeof module.require === 'function') {
    return module.require.bind(module)
  }
  try {
    const maybeRequire = Function('return typeof require !== "undefined" ? require : undefined')()
    if (typeof maybeRequire === 'function') return maybeRequire as RequireFn
  } catch {
    // ignore
  }
  return null
}

function loadRedisModuleViaRequire(): PossibleRedisModule | null {
  const resolver = resolveRequire()
  if (!resolver) return null
  try {
    return resolver('ioredis') as PossibleRedisModule
  } catch {
    return null
  }
}

function pickRedisConstructor(mod: PossibleRedisModule): RedisConstructor | null {
  const queue: unknown[] = [mod]
  const seen = new Set<unknown>()
  while (queue.length) {
    const current = queue.shift()
    if (!current || seen.has(current)) continue
    seen.add(current)
    if (typeof current === 'function') return current as RedisConstructor
    if (typeof current === 'object') {
      queue.push((current as { default?: unknown }).default)
      queue.push((current as { Redis?: unknown }).Redis)
      queue.push((current as { module?: { exports?: unknown } }).module?.exports)
      queue.push((current as { exports?: unknown }).exports)
    }
  }
  return null
}

async function loadRedisModule(): Promise<PossibleRedisModule> {
  if (!redisModulePromise) {
    redisModulePromise = (async () => {
      const required = loadRedisModuleViaRequire() ?? (await import('ioredis'))
      return required as PossibleRedisModule
    })().catch((error) => {
      redisModulePromise = null
      throw new CacheDependencyUnavailableError('redis', 'ioredis', error)
    })
  }
  return redisModulePromise
}

function retainRedisEntry(key: string): RedisRegistryEntry {
  let entry = redisRegistry.get(key)
  if (!entry) {
    entry = { refs: 0 }
    redisRegistry.set(key, entry)
  }
  entry.refs += 1
  return entry
}

async function acquireRedisClient(key: string, entry: RedisRegistryEntry): Promise<RedisClient> {
  if (entry.client) return entry.client
  if (entry.creating) return entry.creating
  entry.creating = loadRedisModule()
    .then((mod) => {
      const ctor = pickRedisConstructor(mod)
      if (!ctor) {
        throw new CacheDependencyUnavailableError('redis', 'ioredis', new Error('No usable Redis constructor'))
      }
      const client = new ctor(key)
      entry.client = client
      entry.creating = undefined
      client.once?.('end', () => {
        if (redisRegistry.get(key) === entry && entry.refs === 0) {
          redisRegistry.delete(key)
        } else if (redisRegistry.get(key) === entry) {
          entry.client = undefined
        }
      })
      return client
    })
    .catch((error) => {
      entry.creating = undefined
      throw error
    })
  return entry.creating
}

async function releaseRedisEntry(key: string, entry: RedisRegistryEntry): Promise<void> {
  entry.refs = Math.max(0, entry.refs - 1)
  if (entry.refs > 0) return
  redisRegistry.delete(key)
  if (entry.client) {
    try {
      await entry.client.quit()
    } catch {
      // ignore shutdown errors
    } finally {
      entry.client = undefined
    }
  }
}

export function createRedisStrategy(redisUrl?: string, options?: { defaultTtl?: number }): CacheStrategy {
  const defaultTtl = options?.defaultTtl
  const keyPrefix = 'cache:'
  const tagPrefix = 'tag:'
  const connectionUrl =
    redisUrl || process.env.REDIS_URL || process.env.CACHE_REDIS_URL || 'redis://localhost:6379'
  const registryEntry = retainRedisEntry(connectionUrl)
  let redis: RedisClient | null = registryEntry.client ?? null

  async function getRedisClient(): Promise<RedisClient> {
    if (redis) return redis

    redis = await acquireRedisClient(connectionUrl, registryEntry)
    return redis
  }

  function getCacheKey(key: string): string {
    return `${keyPrefix}${key}`
  }

  function getTagKey(tag: string): string {
    return `${tagPrefix}${tag}`
  }

  function isExpired(entry: CacheEntry): boolean {
    if (entry.expiresAt === null) return false
    return Date.now() > entry.expiresAt
  }

  function matchPattern(key: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(key)
  }

  const get = async (key: string, options?: CacheGetOptions): Promise<CacheValue | null> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)
    const data = await client.get(cacheKey)

    if (!data) return null

    try {
      const entry: CacheEntry = JSON.parse(data)

      if (isExpired(entry)) {
        if (options?.returnExpired) {
          return entry.value
        }
        // Clean up expired entry
        await deleteKey(key)
        return null
      }

      return entry.value
    } catch {
      // Invalid JSON, remove it
      await client.del(cacheKey)
      return null
    }
  }

  const set = async (key: string, value: CacheValue, options?: CacheSetOptions): Promise<void> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)

    // Remove old entry from tag index if it exists
    const oldData = await client.get(cacheKey)
    if (oldData) {
      try {
        const oldEntry: CacheEntry = JSON.parse(oldData)
        // Remove from old tags
        const pipeline = client.pipeline()
        for (const tag of oldEntry.tags) {
          pipeline.srem(getTagKey(tag), key)
        }
        await pipeline.exec()
      } catch {
        // Ignore parse errors
      }
    }

    const ttl = options?.ttl ?? defaultTtl
    const tags = options?.tags || []
    const expiresAt = ttl ? Date.now() + ttl : null

    const entry: CacheEntry = {
      key,
      value,
      tags,
      expiresAt,
      createdAt: Date.now(),
    }

    const pipeline = client.pipeline()

    // Store the entry
    const serialized = JSON.stringify(entry)
    if (ttl) {
      pipeline.setex(cacheKey, Math.ceil(ttl / 1000), serialized)
    } else {
      pipeline.set(cacheKey, serialized)
    }

    // Add to tag index
    for (const tag of tags) {
      pipeline.sadd(getTagKey(tag), key)
    }

    await pipeline.exec()
  }

  const has = async (key: string): Promise<boolean> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)
    const exists = await client.exists(cacheKey)

    if (!exists) return false

    // Check if expired
    const data = await client.get(cacheKey)
    if (!data) return false

    try {
      const entry: CacheEntry = JSON.parse(data)
      if (isExpired(entry)) {
        await deleteKey(key)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  const deleteKey = async (key: string): Promise<boolean> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)

    // Get entry to remove from tag index
    const data = await client.get(cacheKey)
    if (!data) return false

    try {
      const entry: CacheEntry = JSON.parse(data)
      const pipeline = client.pipeline()

      // Remove from tag index
      for (const tag of entry.tags) {
        pipeline.srem(getTagKey(tag), key)
      }

      // Delete the cache entry
      pipeline.del(cacheKey)

      await pipeline.exec()
      return true
    } catch {
      // Just delete the key if we can't parse it
      await client.del(cacheKey)
      return true
    }
  }

  const deleteByTags = async (tags: string[]): Promise<number> => {
    const client = await getRedisClient()
    const keysToDelete = new Set<string>()

    // Collect all keys that have any of the specified tags
    for (const tag of tags) {
      const tagKey = getTagKey(tag)
      const keys = await client.smembers(tagKey)
      for (const key of keys) {
        keysToDelete.add(key)
      }
    }

    // Delete all collected keys
    let deleted = 0
    for (const key of keysToDelete) {
      const success = await deleteKey(key)
      if (success) deleted++
    }

    return deleted
  }

  const clear = async (): Promise<number> => {
    const client = await getRedisClient()
    
    // Get all cache keys
    const cacheKeys = await client.keys(`${keyPrefix}*`)
    const tagKeys = await client.keys(`${tagPrefix}*`)

    if (cacheKeys.length === 0 && tagKeys.length === 0) return 0

    const pipeline = client.pipeline()
    for (const key of [...cacheKeys, ...tagKeys]) {
      pipeline.del(key)
    }

    await pipeline.exec()
    return cacheKeys.length
  }

  const keys = async (pattern?: string): Promise<string[]> => {
    const client = await getRedisClient()
    const searchPattern = pattern 
      ? `${keyPrefix}${pattern}` 
      : `${keyPrefix}*`
    
    const cacheKeys = await client.keys(searchPattern)
    
    // Remove prefix from keys
    const result = cacheKeys.map((key: string) => key.substring(keyPrefix.length))
    
    if (!pattern) return result
    
    // Apply pattern matching (Redis KEYS command uses glob pattern, but we want our pattern)
    return result.filter((key: string) => matchPattern(key, pattern))
  }

  const stats = async (): Promise<{ size: number; expired: number }> => {
    const client = await getRedisClient()
    const cacheKeys = await client.keys(`${keyPrefix}*`)
    
    let expired = 0
    for (const cacheKey of cacheKeys) {
      const data = await client.get(cacheKey)
      if (data) {
        try {
          const entry: CacheEntry = JSON.parse(data)
          if (isExpired(entry)) {
            expired++
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    return { size: cacheKeys.length, expired }
  }

  const cleanup = async (): Promise<number> => {
    const client = await getRedisClient()
    const cacheKeys = await client.keys(`${keyPrefix}*`)
    
    let removed = 0
    for (const cacheKey of cacheKeys) {
      const data = await client.get(cacheKey)
      if (data) {
        try {
          const entry: CacheEntry = JSON.parse(data)
          if (isExpired(entry)) {
            const key = cacheKey.substring(keyPrefix.length)
            await deleteKey(key)
            removed++
          }
        } catch {
          // Remove invalid entries
          await client.del(cacheKey)
          removed++
        }
      }
    }

    return removed
  }

  const close = async (): Promise<void> => {
    await releaseRedisEntry(connectionUrl, registryEntry)
    redis = null
  }

  return {
    get,
    set,
    has,
    delete: deleteKey,
    deleteByTags,
    clear,
    keys,
    stats,
    cleanup,
    close,
  }
}
