import type { CacheStrategy, CacheEntry, CacheGetOptions, CacheSetOptions, CacheValue } from '../types'
import { CacheDependencyUnavailableError } from '../errors'
import { getRedisUrlOrThrow, REDIS_WIRE_PROTOCOL } from '@open-mercato/shared/lib/redis/connection'
import type { RedisProtocolVersion } from '@open-mercato/shared/lib/redis/connection'
import { matchCacheKeyPattern } from '../patterns'
import { decodeCacheText, encodeCacheText, resolveCacheCodecConfig } from '../codec'
import type { CacheCodecOptions } from '../codec'

type RedisPipeline = {
  getBuffer(key: string): RedisPipeline
  smembers(key: string): RedisPipeline
  set(key: string, value: string | Buffer): RedisPipeline
  setex(key: string, ttlSeconds: number, value: string | Buffer): RedisPipeline
  sadd(key: string, value: string): RedisPipeline
  srem(key: string, ...members: string[]): RedisPipeline
  del(...keys: string[]): RedisPipeline
  eval(script: string, numKeys: number, ...args: (string | number | Buffer)[]): RedisPipeline
  exec(): Promise<unknown>
}

type RedisClient = {
  ping(): Promise<string>
  get(key: string): Promise<string | null>
  getBuffer(key: string): Promise<Buffer | null>
  set(key: string, value: string | Buffer): Promise<unknown>
  setex(key: string, ttlSeconds: number, value: string | Buffer): Promise<unknown>
  del(...keys: string[]): Promise<number>
  exists(key: string): Promise<number>
  scan(cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', limit: number): Promise<[string, string[]]>
  smembers(key: string): Promise<string[]>
  mgetBuffer(...keys: string[]): Promise<(Buffer | null)[]>
  srem(key: string, ...members: string[]): Promise<number>
  eval(script: string, numKeys: number, ...args: (string | number | Buffer)[]): Promise<unknown>
  pipeline(): RedisPipeline
  multi(): RedisPipeline
  quit(): Promise<void>
  once?(event: 'end', listener: () => void): void
}

type RedisConstructor = new (url?: string, options?: { protocol?: RedisProtocolVersion }) => RedisClient
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

// The application decoded these observed buffers and found that their current
// tags exclude this index. Compare bytes atomically before removing membership:
// a concurrent retag may have made the index valid again. Compression stays opaque.
// ARGV contains (member, observed buffer) pairs aligned with KEYS[2..].
const REAP_STALE_TAG_MEMBERS = `
local removed = 0
for i = 2, #KEYS do
  local current = redis.call('GET', KEYS[i])
  if not current or current == ARGV[(i - 2) * 2 + 2] then
    removed = removed + redis.call('SREM', KEYS[1], ARGV[(i - 2) * 2 + 1])
  end
end
return removed
`

/** Bounds members per script; payload bytes and execution time remain workload dependent. */
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

export function pickRedisConstructor(mod: PossibleRedisModule): RedisConstructor | null {
  // `mod` goes last: a bundler-wrapped ESM namespace for a CJS module (e.g.
  // Turbopack's `createNS`) can itself be a callable-but-not-constructible
  // wrapper around the real class, while `.default`/`.Redis` still point at
  // the real class. Checking them first costs nothing for a plain CJS
  // `require()` or a real Node ESM namespace, where they already agree with
  // `mod`.
  const queue: unknown[] = [
    (mod as { default?: unknown } | null | undefined)?.default,
    (mod as { Redis?: unknown } | null | undefined)?.Redis,
    mod,
  ]
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
      const client = new ctor(key, { protocol: REDIS_WIRE_PROTOCOL })
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

export function createRedisStrategy(redisUrl?: string, options?: { defaultTtl?: number } & CacheCodecOptions): CacheStrategy {
  const defaultTtl = options?.defaultTtl
  const codec = resolveCacheCodecConfig(options)
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

  // SCAN may return duplicate keys and empty pages before the cursor reaches 0.
  // COUNT is a work hint, not a strict page-size or latency bound.
  async function scanKeys(pattern: string): Promise<string[]> {
    const client = await getRedisClient()
    const keys = new Set<string>()
    let cursor = '0'
    do {
      const [next, page] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 256)
      cursor = next
      for (const key of page) keys.add(key)
    } while (cursor !== '0')
    return [...keys]
  }

  function isExpired(entry: CacheEntry): boolean {
    if (entry.expiresAt === null) return false
    return Date.now() > entry.expiresAt
  }

  const get = async (key: string, options?: CacheGetOptions): Promise<CacheValue | null> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)
    const data = await client.getBuffer(cacheKey)

    if (!data) return null

    try {
      const entry: CacheEntry = JSON.parse(decodeCacheText(data))

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

    // Old memberships are reconciled by deleteByTags using current entry tags.
    // ioredis sends MULTI, the commands and EXEC together, without a pre-read.
    const pipeline = client.multi()

    // Store the entry
    const serialized = encodeCacheText(JSON.stringify(entry), codec)
    if (ttl) {
      pipeline.setex(cacheKey, Math.ceil(ttl / 1000), serialized)
    } else {
      pipeline.set(cacheKey, serialized)
    }

    // Add to tag index
    for (const tag of tags) {
      pipeline.sadd(getTagKey(tag), key)
    }

    await executePipeline(pipeline)
  }

  const has = async (key: string): Promise<boolean> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)
    const exists = await client.exists(cacheKey)

    if (!exists) return false

    // Check if expired
    const data = await client.getBuffer(cacheKey)
    if (!data) return false

    try {
      const entry: CacheEntry = JSON.parse(decodeCacheText(data))
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
    const data = await client.getBuffer(cacheKey)
    if (!data) return false

    try {
      const entry: CacheEntry = JSON.parse(decodeCacheText(data))
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


  // Experimental entry-count bound; reply bytes and tag fanout remain workload dependent.
  const batchSize = 256

  async function executePipeline(pipeline: RedisPipeline): Promise<[Error | null, unknown][]> {
    const result = await pipeline.exec() as [Error | null, unknown][] | null
    if (!result) throw new Error('[internal] Redis pipeline aborted')
    for (const [error] of result) if (error) throw error
    return result
  }

  async function readBuffers(client: RedisClient, keys: string[]): Promise<(Buffer | null)[]> {
    const values = await client.mgetBuffer(...keys)
    if (values.length !== keys.length || values.some((value) => value !== null && !Buffer.isBuffer(value))) {
      throw new Error('[internal] Unexpected binary Redis batch reply')
    }
    const missingKeys = keys.filter((_, index) => values[index] === null)
    if (missingKeys.length > 0) {
      // Detect WRONGTYPE without consuming a value rebuilt after the original MISS.
      const validation = client.pipeline()
      for (const key of missingKeys) validation.getBuffer(key)
      await executePipeline(validation)
    }
    return values as (Buffer | null)[]
  }

  async function removeEntries(
    client: RedisClient,
    members: string[],
    data: (Buffer | null)[],
    requestedTags: Set<string>,
    tagsByMember: Map<string, string[]>,
  ): Promise<number> {
    const valueKeys: string[] = []
    const groups = new Map<string, string[]>()
    const orphans = new Map<string, string[]>()
    const stale = new Map<string, { member: string; buffer: Buffer }[]>()
    for (let index = 0; index < members.length; index++) {
      const buffer = data[index]
      const member = members[index]
      const memberTags = tagsByMember.get(member) ?? []
      if (!buffer) {
        for (const tagKey of memberTags) {
          const list = orphans.get(tagKey) ?? []
          list.push(member)
          orphans.set(tagKey, list)
        }
        continue
      }

      let entryTags: Set<string> | undefined
      try {
        const entry: CacheEntry = JSON.parse(decodeCacheText(buffer))
        if (Array.isArray(entry.tags) && entry.tags.every((tag) => typeof tag === 'string')) {
          entryTags = new Set(entry.tags)
        }
      } catch { /* Corrupt entries are deleted, as with deleteKey(). */ }
      if (entryTags) {
        for (const tagKey of memberTags) {
          if (entryTags.has(tagKey.slice(tagPrefix.length))) continue
          const list = stale.get(tagKey) ?? []
          list.push({ member, buffer })
          stale.set(tagKey, list)
        }
        if (![...entryTags].some((tag) => requestedTags.has(tag))) continue
        for (const tag of entryTags) {
          const tagKey = getTagKey(tag)
          const list = groups.get(tagKey) ?? []
          list.push(member)
          groups.set(tagKey, list)
        }
      }
      valueKeys.push(getCacheKey(member))
    }
    if (!valueKeys.length && !orphans.size && !stale.size) return 0
    const pipeline = client.pipeline()
    for (const [tagKey, list] of groups) pipeline.srem(tagKey, ...list)
    if (valueKeys.length) pipeline.del(...valueKeys)
    for (const [tagKey, list] of orphans) {
      for (let offset = 0; offset < list.length; offset += REAP_CHUNK_SIZE) {
        const chunk = list.slice(offset, offset + REAP_CHUNK_SIZE)
        const keys = [tagKey, ...chunk.map(getCacheKey)]
        pipeline.eval(REAP_ORPHANED_TAG_MEMBERS, keys.length, ...keys, ...chunk)
      }
    }
    for (const [tagKey, list] of stale) {
      for (let offset = 0; offset < list.length; offset += REAP_CHUNK_SIZE) {
        const chunk = list.slice(offset, offset + REAP_CHUNK_SIZE)
        const keys = [tagKey, ...chunk.map(({ member }) => getCacheKey(member))]
        pipeline.eval(REAP_STALE_TAG_MEMBERS, keys.length, ...keys, ...chunk.flatMap(({ member, buffer }) => [member, buffer]))
      }
    }
    await executePipeline(pipeline)
    return valueKeys.length
  }

  const deleteByTags = async (tags: string[]): Promise<number> => {
    const client = await getRedisClient()
    const requestedTags = new Set(tags)
    const keysToDelete = new Set<string>()
    // Keep only actual memberships. Each read batch reconciles its indexes so
    // observed value buffers are released before reading the next batch.
    const tagsByMember = new Map<string, string[]>()

    // Collect all keys that have any of the specified tags
    const tagPipeline = client.pipeline()
    const uniqueTags = [...requestedTags]
    for (const tag of uniqueTags) tagPipeline.smembers(getTagKey(tag))
    const tagReplies = uniqueTags.length ? await executePipeline(tagPipeline) : []
    for (let index = 0; index < uniqueTags.length; index++) {
      const keys = tagReplies[index][1] as string[]
      const tagKey = getTagKey(uniqueTags[index])
      for (const key of keys) {
        keysToDelete.add(key)
        const memberTags = tagsByMember.get(key) ?? []
        memberTags.push(tagKey)
        tagsByMember.set(key, memberTags)
      }
    }

    // Delete all collected keys
    let deleted = 0
    const members = [...keysToDelete]
    for (let offset = 0; offset < members.length; offset += batchSize) {
      const chunk = members.slice(offset, offset + batchSize)
      const data = await readBuffers(client, chunk.map(getCacheKey))
      deleted += await removeEntries(client, chunk, data, requestedTags, tagsByMember)
    }

    return deleted
  }

  const clear = async (): Promise<number> => {
    const client = await getRedisClient()
    
    // Get all cache keys
    const cacheKeys = await scanKeys(`${keyPrefix}*`)
    const tagKeys = await scanKeys(`${tagPrefix}*`)

    if (cacheKeys.length === 0 && tagKeys.length === 0) return 0

    const physicalKeys = [...cacheKeys, ...tagKeys]
    for (let offset = 0; offset < physicalKeys.length; offset += batchSize) {
      const chunk = physicalKeys.slice(offset, offset + batchSize)
      const pipeline = client.pipeline()
      for (const key of chunk) pipeline.del(key)
      await executePipeline(pipeline)
    }
    return cacheKeys.length
  }

  const keys = async (pattern?: string): Promise<string[]> => {
    const client = await getRedisClient()
    const searchPattern = pattern 
      ? `${keyPrefix}${pattern}` 
      : `${keyPrefix}*`
    
    const cacheKeys = await scanKeys(searchPattern)
    
    // Remove prefix from keys
    const result = cacheKeys.map((key: string) => key.substring(keyPrefix.length))
    
    if (!pattern) return result
    
    // Apply pattern matching (Redis KEYS command uses glob pattern, but we want our pattern)
    return result.filter((key: string) => matchCacheKeyPattern(key, pattern))
  }

  const stats = async (): Promise<{ size: number; expired: number }> => {
    const client = await getRedisClient()
    const cacheKeys = await scanKeys(`${keyPrefix}*`)
    
    let expired = 0
    for (let offset = 0; offset < cacheKeys.length; offset += batchSize) {
      const data = await readBuffers(client, cacheKeys.slice(offset, offset + batchSize))
      for (const buffer of data) {
        if (!buffer) continue
        try { if (isExpired(JSON.parse(decodeCacheText(buffer)))) expired++ }
        catch { /* stats ignores corrupt entries, as before. */ }
      }
    }

    return { size: cacheKeys.length, expired }
  }

  const cleanup = async (): Promise<number> => {
    const client = await getRedisClient()
    const cacheKeys = await scanKeys(`${keyPrefix}*`)
    
    let removed = 0
    for (let offset = 0; offset < cacheKeys.length; offset += batchSize) {
      const chunk = cacheKeys.slice(offset, offset + batchSize)
      const data = await readBuffers(client, chunk)
      for (let index = 0; index < chunk.length; index++) {
        const buffer = data[index]
        if (!buffer) continue
        try {
          if (isExpired(JSON.parse(decodeCacheText(buffer)))) {
            await deleteKey(chunk[index].substring(keyPrefix.length))
            removed++
          }
        } catch {
          await client.del(chunk[index])
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
