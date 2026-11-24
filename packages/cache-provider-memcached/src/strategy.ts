import type { CacheProviderHostContext } from '@open-mercato/cache/provider'
import type { CacheGetOptions, CacheSetOptions, CacheStrategy, CacheValue } from '@open-mercato/cache/types'
import type { MemcachedClient, MemcachedCommandName } from './protocol/client'
import { MemcachedCacheError, isMemcachedCacheError, toProviderFailure } from './errors'
import {
  BUCKET_ENVELOPE_BYTES,
  ITEM_OVERHEAD_BYTES,
  allBucketItemKeys,
  bucketIndexFor,
  bucketItemKey,
  decodeBucket,
  estimateEntryBytes,
  fitBucket,
  isEntryExpired,
  routingKey,
  type BucketEntries,
  type StoredEntry,
} from './layout'
import type { MemcachedProviderConfig } from './settings'

const MAX_COALESCED_MUTATIONS = 64
const EVICTION_WARNING_INTERVAL_MS = 60_000

type MutationContext = {
  now: number
  markDirty(): void
}

type QueuedMutation = {
  apply(entries: BucketEntries, context: MutationContext): unknown
  writesRoute: string | null
  resolve(value: unknown): void
  reject(error: unknown): void
}

type BucketQueue = {
  items: QueuedMutation[]
  running: boolean
}

export type MemcachedStrategyDiagnostics = {
  casConflicts: number
  casRetriesExhausted: number
  capacityEvictions: number
  expiredReclaimed: number
  corruptBucketsReset: number
  serverItemSizeMax: number | null
  effectiveItemLimitBytes: number
  commandCounts: Record<MemcachedCommandName, number>
}

export type MemcachedCacheStrategy = CacheStrategy & {
  healthcheck(): Promise<void>
  cleanup(): Promise<number>
  close(): Promise<void>
  diagnostics(): MemcachedStrategyDiagnostics
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseItemSizeMax(stats: Map<string, string>): number | null {
  const raw = stats.get('item_size_max')
  const value = raw !== undefined ? Number(raw) : Number.NaN
  return Number.isInteger(value) && value > 0 ? value : null
}

export function createMemcachedStrategy(
  client: MemcachedClient,
  config: MemcachedProviderConfig,
  context: CacheProviderHostContext,
  server: { itemSizeMax: number | null },
): MemcachedCacheStrategy {
  const { namespace, helpers, logger } = context
  const bucketCount = config.bucketCount
  const bucketKeys = allBucketItemKeys(namespace, bucketCount)
  const queues = new Map<number, BucketQueue>()
  const diagnostics = {
    casConflicts: 0,
    casRetriesExhausted: 0,
    capacityEvictions: 0,
    expiredReclaimed: 0,
    corruptBucketsReset: 0,
  }
  let serverItemSizeMax = server.itemSizeMax
  let lastEvictionWarning = 0
  let closed: Promise<void> | null = null

  const longestBucketKey = bucketKeys.reduce((longest, key) => Math.max(longest, key.length), 0)
  const effectiveItemLimit = () => {
    const ceiling = serverItemSizeMax !== null ? Math.min(serverItemSizeMax, config.maxItemBytes) : config.maxItemBytes
    return ceiling - longestBucketKey - ITEM_OVERHEAD_BYTES
  }

  const guard = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      throw toProviderFailure(error)
    }
  }

  const readBucket = async (index: number): Promise<BucketEntries> => {
    const item = await client.metaGet(bucketKeys[index])
    if (!item) return new Map()
    return decodeBucket(item.value) ?? new Map()
  }

  const forEachBucket = async (visit: (index: number, entries: BucketEntries) => void): Promise<void> => {
    for (let start = 0; start < bucketCount; start += config.enumerationBatchSize) {
      const keys = bucketKeys.slice(start, start + config.enumerationBatchSize)
      const items = await client.metaGetMany(keys)
      keys.forEach((key, offset) => {
        const item = items.get(key)
        if (!item) return
        const entries = decodeBucket(item.value)
        visit(start + offset, entries ?? new Map())
      })
    }
  }

  const warnEviction = (evicted: number) => {
    diagnostics.capacityEvictions += evicted
    const now = Date.now()
    if (now - lastEvictionWarning < EVICTION_WARNING_INTERVAL_MS) return
    lastEvictionWarning = now
    logger.warn('bucket reached the item size limit; oldest entries were evicted', {
      evicted,
      totalEvicted: diagnostics.capacityEvictions,
      bucketCount,
    })
  }

  const backoff = (attempt: number) => {
    if (config.casBackoffMs <= 0) return Promise.resolve()
    const ceiling = config.casBackoffMs * 2 ** Math.min(attempt, 6)
    return sleep(Math.floor(Math.random() * ceiling) + 1)
  }

  const commit = async (index: number, batch: QueuedMutation[]): Promise<unknown[]> => {
    const key = bucketKeys[index]
    for (let attempt = 0; attempt < config.casRetries; attempt++) {
      const item = await client.metaGet(key)
      const decoded = item ? decodeBucket(item.value) : null
      const entries: BucketEntries = decoded ?? new Map()
      let dirty = item !== null && decoded === null
      const mutationContext: MutationContext = { now: Date.now(), markDirty: () => { dirty = true } }
      const results = batch.map((mutation) => mutation.apply(entries, mutationContext))
      let reclaimed = 0
      for (const [entryKey, entry] of entries) {
        if (isEntryExpired(entry, mutationContext.now)) {
          entries.delete(entryKey)
          reclaimed += 1
        }
      }
      if (reclaimed > 0) dirty = true
      if (!dirty) return results

      let outcome: string
      if (entries.size === 0) {
        if (!item) return results
        outcome = await client.metaDelete(key, { cas: item.cas })
        if (outcome === 'deleted' || outcome === 'not_found') {
          diagnostics.expiredReclaimed += reclaimed
          if (item && decoded === null) diagnostics.corruptBucketsReset += 1
          return results
        }
      } else {
        const protectedRoutes = new Set<string>()
        for (const mutation of batch) if (mutation.writesRoute) protectedRoutes.add(mutation.writesRoute)
        const fitted = fitBucket(entries, effectiveItemLimit(), protectedRoutes)
        if (!fitted) {
          throw new MemcachedCacheError('item_too_large', 'Cache entries exceed the memcached item size limit of their bucket')
        }
        outcome = item
          ? await client.metaSet(key, fitted.buffer, { cas: item.cas })
          : await client.metaSet(key, fitted.buffer, { mode: 'add' })
        if (outcome === 'stored') {
          diagnostics.expiredReclaimed += reclaimed
          if (item && decoded === null) diagnostics.corruptBucketsReset += 1
          if (fitted.evicted > 0) warnEviction(fitted.evicted)
          return results
        }
      }
      diagnostics.casConflicts += 1
      await backoff(attempt)
    }
    diagnostics.casRetriesExhausted += 1
    throw new MemcachedCacheError('cas_conflict', `Memcached bucket update did not succeed within ${config.casRetries} compare-and-swap attempts`)
  }

  const commitWithFallback = async (index: number, batch: QueuedMutation[]): Promise<void> => {
    try {
      const results = await commit(index, batch)
      batch.forEach((mutation, position) => mutation.resolve(results[position]))
    } catch (error) {
      if (batch.length > 1 && isMemcachedCacheError(error) && error.code === 'item_too_large') {
        for (const mutation of batch) {
          try {
            const [result] = await commit(index, [mutation])
            mutation.resolve(result)
          } catch (singleError) {
            mutation.reject(singleError)
          }
        }
        return
      }
      for (const mutation of batch) mutation.reject(error)
    }
  }

  const drain = async (index: number, queue: BucketQueue): Promise<void> => {
    queue.running = true
    try {
      while (queue.items.length > 0) {
        const batch = queue.items.splice(0, MAX_COALESCED_MUTATIONS)
        await commitWithFallback(index, batch)
      }
    } finally {
      queue.running = false
      if (queue.items.length === 0 && queues.get(index) === queue) queues.delete(index)
    }
  }

  const mutate = <R>(
    index: number,
    apply: (entries: BucketEntries, context: MutationContext) => R,
    writesRoute: string | null = null,
  ): Promise<R> => new Promise<R>((resolve, reject) => {
    const queue = queues.get(index) ?? { items: [], running: false }
    queues.set(index, queue)
    queue.items.push({
      apply,
      writesRoute,
      resolve: resolve as (value: unknown) => void,
      reject,
    })
    if (!queue.running) void drain(index, queue)
  })

  const decodeValue = (entry: StoredEntry): { ok: true; value: CacheValue } | { ok: false } => {
    try {
      const raw = entry.b === 1 ? Buffer.from(entry.p, 'base64') : entry.p
      return { ok: true, value: JSON.parse(helpers.decode(raw)) as CacheValue }
    } catch {
      return { ok: false }
    }
  }

  const dropCorruptEntry = (index: number, key: string, payload: string) => {
    logger.warn('dropping undecodable cache entry')
    mutate(index, (entries, mutationContext) => {
      const current = entries.get(key)
      if (current && current.p === payload) {
        entries.delete(key)
        mutationContext.markDirty()
      }
      return null
    }).catch(() => undefined)
  }

  const readEntry = async (key: string, returnExpired: boolean): Promise<{ found: false } | { found: true; value: CacheValue }> => {
    const index = bucketIndexFor(key, bucketCount)
    const entries = await readBucket(index)
    const entry = entries.get(key)
    if (!entry) return { found: false }
    if (!returnExpired && isEntryExpired(entry, Date.now())) return { found: false }
    const decoded = decodeValue(entry)
    if (!decoded.ok) {
      dropCorruptEntry(index, key, entry.p)
      return { found: false }
    }
    return { found: true, value: decoded.value }
  }

  const removeMatching = async (predicate: (entry: StoredEntry, now: number) => boolean): Promise<number> => {
    const candidates: number[] = []
    const now = Date.now()
    await forEachBucket((index, entries) => {
      if (entries.size === 0) {
        candidates.push(index)
        return
      }
      for (const entry of entries.values()) {
        if (predicate(entry, now)) {
          candidates.push(index)
          return
        }
      }
    })
    let removed = 0
    for (let start = 0; start < candidates.length; start += config.enumerationBatchSize) {
      const wave = candidates.slice(start, start + config.enumerationBatchSize)
      const counts = await Promise.all(wave.map((index) => mutate(index, (entries, mutationContext) => {
        let count = 0
        for (const [key, entry] of entries) {
          if (predicate(entry, mutationContext.now)) {
            entries.delete(key)
            count += 1
          }
        }
        if (count > 0) mutationContext.markDirty()
        return count
      })))
      for (const count of counts) removed += count
    }
    return removed
  }

  const refreshServerLimits = async () => {
    serverItemSizeMax = parseItemSizeMax(await client.stats('settings')) ?? serverItemSizeMax
  }

  return {
    get: (key: string, options?: CacheGetOptions) => guard(async () => {
      const result = await readEntry(key, options?.returnExpired === true)
      return result.found ? result.value : null
    }),

    set: (key: string, value: CacheValue, options?: CacheSetOptions) => guard(async () => {
      const ttl = options?.ttl ?? context.defaultTtl
      const json = JSON.stringify(value === undefined ? null : value)
      const encoded = helpers.encode(json)
      const now = Date.now()
      const entry: StoredEntry = {
        p: typeof encoded === 'string' ? encoded : Buffer.from(encoded).toString('base64'),
        ...(typeof encoded === 'string' ? {} : { b: 1 as const }),
        t: Array.from(new Set(Array.isArray(options?.tags) ? options.tags.filter((tag) => typeof tag === 'string') : [])),
        x: typeof ttl === 'number' && ttl > 0 ? now + ttl : null,
        c: now,
      }
      if (estimateEntryBytes(key, entry) + BUCKET_ENVELOPE_BYTES > effectiveItemLimit()) {
        throw new MemcachedCacheError('item_too_large', 'Cache value exceeds the memcached item size limit')
      }
      await mutate(bucketIndexFor(key, bucketCount), (entries, mutationContext) => {
        entries.set(key, { ...entry, c: Math.max(entry.c, mutationContext.now) })
        mutationContext.markDirty()
        return null
      }, routingKey(key))
    }),

    has: (key: string) => guard(async () => (await readEntry(key, false)).found),

    delete: (key: string) => guard(() => mutate(bucketIndexFor(key, bucketCount), (entries, mutationContext) => {
      if (!entries.delete(key)) return false
      mutationContext.markDirty()
      return true
    })),

    deleteByTags: (tags: string[]) => guard(async () => {
      const wanted = new Set((Array.isArray(tags) ? tags : []).filter((tag) => typeof tag === 'string' && tag.length > 0))
      if (wanted.size === 0) return 0
      return removeMatching((entry) => entry.t.some((tag) => wanted.has(tag)))
    }),

    clear: () => guard(() => removeMatching(() => true)),

    keys: (pattern?: string) => guard(async () => {
      const found: string[] = []
      await forEachBucket((_index, entries) => {
        for (const key of entries.keys()) {
          if (pattern && !helpers.matchPattern(key, pattern)) continue
          found.push(key)
        }
      })
      return found
    }),

    stats: () => guard(async () => {
      let size = 0
      let expired = 0
      const now = Date.now()
      await forEachBucket((_index, entries) => {
        for (const entry of entries.values()) {
          size += 1
          if (isEntryExpired(entry, now)) expired += 1
        }
      })
      return { size, expired }
    }),

    cleanup: () => guard(() => removeMatching((entry, now) => isEntryExpired(entry, now))),

    healthcheck: () => guard(async () => {
      await client.version()
      await refreshServerLimits()
      if (effectiveItemLimit() <= BUCKET_ENVELOPE_BYTES) {
        throw new MemcachedCacheError('incompatible_server', 'Memcached item size limit is too small for the bucket layout')
      }
    }),

    close: () => {
      if (!closed) closed = client.close()
      return closed
    },

    diagnostics: () => ({
      ...diagnostics,
      serverItemSizeMax,
      effectiveItemLimitBytes: effectiveItemLimit(),
      commandCounts: client.commandCounts(),
    }),
  }
}

export async function probeMemcachedServer(client: MemcachedClient): Promise<{ version: string; itemSizeMax: number | null }> {
  const version = await client.version()
  const itemSizeMax = parseItemSizeMax(await client.stats('settings'))
  return { version, itemSizeMax }
}
