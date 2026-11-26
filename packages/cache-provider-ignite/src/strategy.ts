import type { CacheGetOptions, CacheSetOptions, CacheStrategy, CacheValue } from '@open-mercato/cache/types'
import type { CacheProviderHostContext } from '@open-mercato/cache/provider'
import { IGNITE_PROVIDER_ID, type IgniteCacheProviderConfig } from './settings'
import type { IgniteConnection } from './connection'
import {
  buildStoredRecord,
  isStoredRecordExpired,
  parseStoredRecord,
  serializeStoredRecord,
  storedRecordHasAnyTag,
  storedRecordPayload,
  type StoredRecord,
} from './layout'

export class IgniteCacheValueTooLargeError extends Error {
  readonly code = 'value_too_large'
  readonly providerId = IGNITE_PROVIDER_ID
  readonly limitBytes: number

  constructor(limitBytes: number) {
    super(`Cache provider "${IGNITE_PROVIDER_ID}" refused a value larger than maxValueBytes (${limitBytes} bytes)`)
    this.name = 'IgniteCacheValueTooLargeError'
    this.limitBytes = limitBytes
  }
}

type ScannedRecord = { key: string; raw: string; record: StoredRecord | null }

type RemovalPredicate = (record: StoredRecord | null) => boolean

async function runBounded<T>(items: ReadonlyArray<T>, concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index])
    }
  })
  await Promise.all(lanes)
}

export function createIgniteStrategy(
  config: IgniteCacheProviderConfig,
  context: CacheProviderHostContext,
  connection: IgniteConnection,
): CacheStrategy {
  const { helpers, logger } = context

  const decodeValue = (record: StoredRecord): { ok: true; value: CacheValue } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(helpers.decode(storedRecordPayload(record))) as CacheValue }
    } catch {
      return { ok: false }
    }
  }

  const dropCorrupt = async (key: string, raw: unknown) => {
    logger.warn('dropping undecodable cache record')
    if (typeof raw !== 'string') {
      await connection.run('delete', (cache) => cache.removeKey(key)).catch(() => undefined)
      return
    }
    await connection.run('delete', (cache) => cache.removeIfEquals(key, raw)).catch(() => undefined)
  }

  const read = async (key: string, returnExpired: boolean): Promise<{ found: true; value: CacheValue } | { found: false }> => {
    const raw = await connection.run('get', (cache) => cache.get(key))
    if (raw === null || raw === undefined) return { found: false }
    const record = parseStoredRecord(raw)
    if (!record) {
      await dropCorrupt(key, raw)
      return { found: false }
    }
    if (!returnExpired && isStoredRecordExpired(record, Date.now())) return { found: false }
    const decoded = decodeValue(record)
    if (!decoded.ok) {
      await dropCorrupt(key, raw)
      return { found: false }
    }
    return { found: true, value: decoded.value }
  }

  const scanRecords = async (visit: (entry: ScannedRecord) => Promise<void> | void) => {
    await connection.scan(config.scanPageSize, async (key, raw) => {
      if (typeof raw !== 'string') {
        await visit({ key, raw: '', record: null })
        return
      }
      await visit({ key, raw, record: parseStoredRecord(raw) })
    })
  }

  const removeIfStillMatching = async (entry: ScannedRecord, predicate: RemovalPredicate): Promise<boolean> => {
    let expected = entry.raw
    let record = entry.record
    for (let attempt = 0; attempt < config.casAttempts; attempt++) {
      if (!predicate(record)) return false
      const removed = expected
        ? await connection.run('conditional delete', (cache) => cache.removeIfEquals(entry.key, expected))
        : await connection.run('delete', (cache) => cache.removeKey(entry.key))
      if (removed) return true
      const current = await connection.run('get', (cache) => cache.get(entry.key))
      if (current === null || current === undefined) return false
      expected = typeof current === 'string' ? current : ''
      record = typeof current === 'string' ? parseStoredRecord(current) : null
    }
    throw new Error(`[internal] cache provider "${IGNITE_PROVIDER_ID}" exhausted ${config.casAttempts} conditional delete attempts`)
  }

  const removeMatching = async (predicate: RemovalPredicate, countRecord: (record: StoredRecord | null) => boolean): Promise<number> => {
    let removed = 0
    let batch: ScannedRecord[] = []
    const flush = async () => {
      const pending = batch
      batch = []
      await runBounded(pending, config.mutationConcurrency, async (entry) => {
        if (await removeIfStillMatching(entry, predicate) && countRecord(entry.record)) removed += 1
      })
    }
    await scanRecords(async (entry) => {
      if (!predicate(entry.record)) return
      batch.push(entry)
      if (batch.length >= config.scanPageSize) await flush()
    })
    await flush()
    return removed
  }

  return {
    async get(key: string, options?: CacheGetOptions) {
      const result = await read(key, options?.returnExpired === true)
      return result.found ? result.value : null
    },

    async set(key: string, value: CacheValue, options?: CacheSetOptions) {
      const ttl = options?.ttl ?? context.defaultTtl
      const json = JSON.stringify(value === undefined ? null : value)
      const record = buildStoredRecord({ payload: helpers.encode(json), tags: options?.tags, ttl, now: Date.now() })
      const serialized = serializeStoredRecord(record)
      if (Buffer.byteLength(serialized, 'utf8') > config.maxValueBytes) {
        await connection.run('delete', (cache) => cache.removeKey(key))
        throw new IgniteCacheValueTooLargeError(config.maxValueBytes)
      }
      await connection.run('set', (cache) => cache.put(key, serialized))
    },

    async has(key: string) {
      return (await read(key, false)).found
    },

    async delete(key: string) {
      return connection.run('delete', (cache) => cache.removeKey(key))
    },

    async deleteByTags(tags: string[]) {
      const wanted = new Set(Array.isArray(tags) ? tags : [])
      if (wanted.size === 0) return 0
      return removeMatching(
        (record) => record !== null && storedRecordHasAnyTag(record, wanted),
        () => true,
      )
    },

    async clear() {
      return removeMatching(() => true, (record) => record !== null)
    },

    async keys(pattern?: string) {
      const found: string[] = []
      await scanRecords(({ key, record }) => {
        if (!record) return
        if (pattern && !helpers.matchPattern(key, pattern)) return
        found.push(key)
      })
      return found
    },

    async stats() {
      let size = 0
      let expired = 0
      const now = Date.now()
      await scanRecords(({ record }) => {
        if (!record) return
        size += 1
        if (isStoredRecordExpired(record, now)) expired += 1
      })
      return { size, expired }
    },

    async cleanup() {
      const now = Date.now()
      return removeMatching(
        (record) => record === null || isStoredRecordExpired(record, now),
        (record) => record !== null,
      )
    },

    async healthcheck() {
      await connection.run('healthcheck', (cache) => cache.containsKey('__om_cache_healthcheck__'))
    },

    async close() {
      await connection.close()
    },
  }
}
