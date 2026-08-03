import type { CacheStrategy, CacheEntry, CacheGetOptions, CacheSetOptions, CacheValue } from '../types'
import { CacheDependencyUnavailableError } from '../errors'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import { matchCacheKeyPattern } from '../patterns'

type RedisPipeline = {
  set(key: string, value: string): RedisPipeline
  setex(key: string, ttlSeconds: number, value: string): RedisPipeline
  sadd(key: string, value: string): RedisPipeline
  srem(key: string, member: string): RedisPipeline
  del(key: string): RedisPipeline
  eval(script: string, numKeys: number, ...args: (string | number)[]): RedisPipeline
  exec(): Promise<unknown>
}

type RedisClient = {
  ping(): Promise<string>
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
 * Reaps orphaned members from ONE tag set atomically.
 *
 * `KEYS[1]` is the tag key and `KEYS[2..]` are the candidate value keys, with
 * `ARGV[1..]` the member names aligned to them. Every key the script touches is
 * declared in `KEYS` so it stays valid against a slot-aware deployment.
 *
 * The `EXISTS` check and the `SREM` run in one atomic step, which is the whole
 * point: a member may only be dropped while its value key is genuinely absent.
 * A concurrent `set()` either lands first (`EXISTS` is 1, so the member is left
 * alone) or lands after (its own `sadd` re-adds the member). Either ordering
 * leaves a live key indexed.
 *
 * Deliberately single-tag. Pairing every orphan with every requested tag would
 * make the work quadratic in the tag count — and because a script blocks the
 * server for its whole run, that lands as a stall rather than as throughput.
 * Callers reap per tag using the membership each `smembers` actually returned.
 */
const REAP_ORPHANED_TAG_MEMBERS = `
local removed = 0
for i = 2, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 0 then
    removed = removed + redis.call('SREM', KEYS[1], ARGV[i - 1])
  end
end
return removed
`

/** Bounds a single script's blocking time on the server, and the request size. */
const REAP_CHUNK_SIZE = 256

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
  const connectionUrl = redisUrl || getRedisUrlOrThrow('CACHE')
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
    // Keep which tag each key came from. Reaping needs it to stay linear in the
    // memberships that actually exist rather than in tags x keys.
    const membersByTagKey = new Map<string, string[]>()

    // Collect all keys that have any of the specified tags
    for (const tag of tags) {
      const tagKey = getTagKey(tag)
      const keys = await client.smembers(tagKey)
      membersByTagKey.set(tagKey, keys)
      for (const key of keys) {
        keysToDelete.add(key)
      }
    }

    // Delete all collected keys
    let deleted = 0
    const orphans = new Set<string>()
    for (const key of keysToDelete) {
      const success = await deleteKey(key)
      if (success) deleted++
      else orphans.add(key)
    }

    // A key whose value has already expired leaves its name behind in every tag
    // set it was added to: `set()` only prunes tags when it overwrites a live
    // key, `deleteKey` only prunes when it finds one, and `cleanup()` scans
    // value keys rather than tag sets. Nothing else reaps them, so the sets grow
    // without bound whenever TTL'd entries also rotate their key names — and
    // every later invalidation pays a GET per orphan. Reap what we just walked.
    //
    // `deleteKey` reported these missing some time ago — the walk above is one
    // round trip per member — so a concurrent request may have rebuilt any of
    // them since. Re-check each value key atomically with the removal rather
    // than trusting that stale read: dropping a live key from the index would
    // silently exempt it from every future invalidation of this tag.
    //
    // Reap per tag, over that tag's own members, so the work stays linear in the
    // memberships `smembers` actually returned. Each script is capped at
    // REAP_CHUNK_SIZE members, so no single atomic call can stall the server for
    // longer than a fixed bound however many tags were requested. The calls are
    // pipelined into one round trip, but stay separate scripts so Redis can
    // serve other clients between them.
    if (orphans.size > 0) {
      const pipeline = client.pipeline()
      let queued = 0
      for (const [tagKey, members] of membersByTagKey) {
        const tagOrphans = members.filter((member) => orphans.has(member))
        for (let offset = 0; offset < tagOrphans.length; offset += REAP_CHUNK_SIZE) {
          const chunk = tagOrphans.slice(offset, offset + REAP_CHUNK_SIZE)
          const keys = [tagKey, ...chunk.map(getCacheKey)]
          pipeline.eval(REAP_ORPHANED_TAG_MEMBERS, keys.length, ...keys, ...chunk)
          queued++
        }
      }
      if (queued > 0) await pipeline.exec()
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
    return result.filter((key: string) => matchCacheKeyPattern(key, pattern))
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

  const healthcheck = async (): Promise<void> => {
    const client = await getRedisClient()
    await client.ping()
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
    healthcheck,
    cleanup,
    close,
  }
}
