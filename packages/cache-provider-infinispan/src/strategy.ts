import { randomBytes } from 'node:crypto'
import { CacheProviderError, type CacheProviderHostContext } from '@open-mercato/cache/provider'
import type { CacheGetOptions, CacheSetOptions, CacheStrategy, CacheValue } from '@open-mercato/cache/types'
import { PROVIDER_ID, type HotRodGateway, type HotRodStoreOptions } from './client'
import {
  decodeEntryRecord,
  decodeTagShard,
  encodeEntryRecord,
  encodeTagShard,
  entryKey,
  entryKeyPrefix,
  indexedTags,
  isMemberReclaimable,
  namespacePrefix,
  scopeTagKeyPrefix,
  tagKeyPrefix,
  tagShardIndex,
  tagShardKey,
  tagShardKeysFor,
  tagShardLifespanMs,
  type EntryRecord,
  type TagMember,
  type TagShard,
} from './layout'
import type { InfinispanSettings } from './settings'

export type InfinispanStrategy = CacheStrategy & {
  healthcheck(): Promise<void>
  cleanup(): Promise<number>
  close(): Promise<void>
}

export type InfinispanStrategyOptions = {
  gateway: HotRodGateway
  config: InfinispanSettings
  context: CacheProviderHostContext
  now?: () => number
  createWriteId?: () => string
}

type EntryRead =
  | { state: 'missing' }
  | { state: 'corrupt'; version: Buffer }
  | { state: 'ok'; record: EntryRecord; version: Buffer }

type InvalidationOutcome = {
  removedWriteId: string | null
  observedWriteId: string | null
}

type MemberObservation = {
  shardKey: string
  member: TagMember
}

async function mapLimit<T>(items: ReadonlyArray<T>, limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  })
  await Promise.all(lanes)
}

function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function lifespan(ms: number | null): HotRodStoreOptions | undefined {
  return ms === null ? undefined : { lifespan: `${Math.max(1, Math.ceil(ms))}ms` }
}

function backoff(attempt: number): Promise<void> {
  const ceiling = Math.min(50, 2 ** Math.min(attempt, 6))
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * ceiling)))
}

function contention(operation: string): CacheProviderError {
  return new CacheProviderError('unavailable', `Cache provider "${PROVIDER_ID}" ${operation} exceeded maxCasAttempts under contention`, { providerId: PROVIDER_ID })
}

function uniqueTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return Array.from(new Set(tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)))
}

export function createInfinispanStrategy(options: InfinispanStrategyOptions): InfinispanStrategy {
  const { gateway, config, context } = options
  const { helpers, logger, namespace } = context
  const now = options.now ?? (() => Date.now())
  const createWriteId = options.createWriteId ?? (() => randomBytes(9).toString('base64url'))
  const graceMs = config.indexPruneGraceMs
  const shards = config.tagIndexShards
  const writeDeadlineMs = graceMs - config.commandTimeoutMs * 4
  const healthKey = `${namespacePrefix(namespace)}health`

  async function readEntry(physicalKey: string): Promise<EntryRead> {
    const stored = await gateway.getVersioned('get', entryKey(namespace, physicalKey))
    if (!stored) return { state: 'missing' }
    const record = decodeEntryRecord(stored.value)
    if (!record) return { state: 'corrupt', version: stored.version }
    return { state: 'ok', record, version: stored.version }
  }

  async function discardCorrupt(physicalKey: string, version: Buffer): Promise<boolean> {
    logger.warn('dropping undecodable cache entry')
    try {
      return await gateway.run('remove', (client) => client.removeWithVersion(entryKey(namespace, physicalKey), version))
    } catch {
      return false
    }
  }

  function decodeValue(record: EntryRecord): CacheValue {
    const raw = record.encoding === 'base64' ? Buffer.from(record.payload, 'base64') : record.payload
    return JSON.parse(helpers.decode(raw)) as CacheValue
  }

  async function readLive(physicalKey: string): Promise<{ found: false } | { found: true; value: CacheValue }> {
    const entry = await readEntry(physicalKey)
    if (entry.state === 'missing') return { found: false }
    if (entry.state === 'corrupt') {
      await discardCorrupt(physicalKey, entry.version)
      return { found: false }
    }
    try {
      return { found: true, value: decodeValue(entry.record) }
    } catch {
      await discardCorrupt(physicalKey, entry.version)
      return { found: false }
    }
  }

  async function addMember(tag: string, physicalKey: string, member: TagMember): Promise<void> {
    const shardKey = tagShardKey(namespace, tag, tagShardIndex(physicalKey, shards), shards)
    for (let attempt = 0; attempt < config.maxCasAttempts; attempt++) {
      if (attempt > 0) await backoff(attempt)
      const current = await gateway.getVersioned('tag index read', shardKey)
      const at = now()
      if (!current) {
        const fresh: TagShard = new Map([[physicalKey, member]])
        const created = await gateway.run('tag index create', (client) =>
          client.putIfAbsent(shardKey, encodeTagShard(fresh), lifespan(tagShardLifespanMs(fresh, at, graceMs))))
        if (created) return
        continue
      }
      let shard = decodeTagShard(current.value)
      if (!shard) {
        logger.error('replacing undecodable tag index shard; entries it referenced may survive invalidation until they expire')
        shard = new Map()
      }
      for (const [key, existing] of shard) {
        if (key !== physicalKey && isMemberReclaimable(existing, at, graceMs)) shard.delete(key)
      }
      shard.set(physicalKey, member)
      const replaced = await gateway.run('tag index update', (client) =>
        client.replaceWithVersion(shardKey, encodeTagShard(shard), current.version, lifespan(tagShardLifespanMs(shard, at, graceMs))))
      if (replaced) return
    }
    throw contention('tag index update')
  }

  async function removeMembers(shardKey: string, expected: Map<string, string | null>): Promise<void> {
    for (let attempt = 0; attempt < config.maxCasAttempts; attempt++) {
      if (attempt > 0) await backoff(attempt)
      const current = await gateway.getVersioned('tag index read', shardKey)
      if (!current) return
      const shard = decodeTagShard(current.value)
      if (!shard) return
      const at = now()
      let changed = false
      for (const [key, member] of shard) {
        const expectedWriteId = expected.get(key)
        const matches = expectedWriteId === undefined
          ? isMemberReclaimable(member, at, graceMs)
          : expectedWriteId === null || expectedWriteId === member.writeId
        if (matches) {
          shard.delete(key)
          changed = true
        }
      }
      if (!changed) return
      const done = shard.size === 0
        ? await gateway.run('tag index remove', (client) => client.removeWithVersion(shardKey, current.version))
        : await gateway.run('tag index update', (client) =>
          client.replaceWithVersion(shardKey, encodeTagShard(shard), current.version, lifespan(tagShardLifespanMs(shard, at, graceMs))))
      if (done) return
    }
    throw contention('tag index prune')
  }

  async function pruneQuietly(prunes: Map<string, Map<string, string | null>>): Promise<void> {
    await mapLimit(Array.from(prunes.entries()), config.concurrency, async ([shardKey, expected]) => {
      try {
        await removeMembers(shardKey, expected)
      } catch (error) {
        logger.warn('tag index prune deferred', { error })
      }
    })
  }

  function exactPrunes(physicalKey: string, record: EntryRecord, into = new Map<string, Map<string, string | null>>()) {
    for (const tag of indexedTags(physicalKey, record.tags)) {
      const shardKey = tagShardKey(namespace, tag, tagShardIndex(physicalKey, shards), shards)
      const expected = into.get(shardKey) ?? new Map<string, string | null>()
      expected.set(physicalKey, record.writeId)
      into.set(shardKey, expected)
    }
    return into
  }

  async function removeCurrent(
    physicalKey: string,
    shouldRemove: (record: EntryRecord) => boolean,
  ): Promise<InvalidationOutcome & { removedRecord: EntryRecord | null }> {
    for (let attempt = 0; attempt < config.maxCasAttempts; attempt++) {
      const entry = await readEntry(physicalKey)
      if (entry.state === 'missing') return { removedWriteId: null, observedWriteId: null, removedRecord: null }
      if (entry.state === 'corrupt') {
        await discardCorrupt(physicalKey, entry.version)
        return { removedWriteId: null, observedWriteId: null, removedRecord: null }
      }
      if (!shouldRemove(entry.record)) {
        return { removedWriteId: null, observedWriteId: entry.record.writeId, removedRecord: null }
      }
      const removed = await gateway.run('remove', (client) => client.removeWithVersion(entryKey(namespace, physicalKey), entry.version))
      if (removed) return { removedWriteId: entry.record.writeId, observedWriteId: entry.record.writeId, removedRecord: entry.record }
    }
    throw contention('conditional remove')
  }

  async function readTagMembers(tags: string[]): Promise<Map<string, MemberObservation[]>> {
    const shardKeys = tags.flatMap((tag) => tagShardKeysFor(namespace, tag, shards))
    const members = new Map<string, MemberObservation[]>()
    await mapLimit(chunk(shardKeys, config.iteratorBatchSize), config.concurrency, async (batch) => {
      const found = await gateway.run('tag index read', (client) => client.getAll(batch))
      for (const { key: shardKey, value } of found) {
        const shard = decodeTagShard(value)
        if (!shard) continue
        for (const [physicalKey, member] of shard) {
          const list = members.get(physicalKey) ?? []
          list.push({ shardKey, member })
          members.set(physicalKey, list)
        }
      }
    })
    return members
  }

  async function removeScopedByPrefix(
    keyPrefixes: string[],
    matches: (record: EntryRecord) => boolean,
    handled: ReadonlyMap<string, unknown>,
    prunes: Map<string, Map<string, string | null>>,
  ): Promise<number> {
    const entryPrefix = entryKeyPrefix(namespace)
    const pending: string[] = []
    let removed = 0
    const flush = async () => {
      const batch = pending.splice(0, pending.length)
      await mapLimit(batch, config.concurrency, async (physicalKey) => {
        const outcome = await removeCurrent(physicalKey, matches)
        if (outcome.removedRecord) {
          removed += 1
          exactPrunes(physicalKey, outcome.removedRecord, prunes)
        }
      })
    }
    await gateway.scan(async (storedKey) => {
      if (!storedKey.startsWith(entryPrefix)) return
      const physicalKey = storedKey.slice(entryPrefix.length)
      if (handled.has(physicalKey) || !keyPrefixes.some((prefix) => physicalKey.startsWith(prefix))) return
      pending.push(physicalKey)
      if (pending.length >= config.iteratorBatchSize) await flush()
    })
    await flush()
    return removed
  }

  async function deleteByTags(tags: string[]): Promise<number> {
    const wanted = uniqueTags(tags)
    if (wanted.length === 0) return 0
    const wantedSet = new Set(wanted)
    const matches = (record: EntryRecord) => record.tags.some((tag) => wantedSet.has(tag))
    const scopePrefixes = wanted.map(scopeTagKeyPrefix).filter((prefix): prefix is string => prefix !== null)
    const candidates = await readTagMembers(wanted)
    const observedAt = now()
    const prunes = new Map<string, Map<string, string | null>>()
    let removed = 0
    await mapLimit(Array.from(candidates.entries()), config.concurrency, async ([physicalKey, observations]) => {
      const outcome = await removeCurrent(physicalKey, matches)
      if (outcome.removedRecord) {
        removed += 1
        exactPrunes(physicalKey, outcome.removedRecord, prunes)
      }
      for (const { shardKey, member } of observations) {
        const exact = outcome.removedWriteId === member.writeId
        const stale = member.writtenAt + graceMs < observedAt && outcome.observedWriteId !== member.writeId
        if (!exact && !stale) continue
        const expected = prunes.get(shardKey) ?? new Map<string, string | null>()
        expected.set(physicalKey, member.writeId)
        prunes.set(shardKey, expected)
      }
    })
    if (scopePrefixes.length > 0) removed += await removeScopedByPrefix(scopePrefixes, matches, candidates, prunes)
    await pruneQuietly(prunes)
    return removed
  }

  async function removeAllMatching(match: (record: EntryRecord | null) => boolean): Promise<{ removed: number; shardKeys: string[] }> {
    const entries: Array<{ physicalKey: string; record: EntryRecord | null }> = []
    const shardKeys: string[] = []
    const entryPrefix = entryKeyPrefix(namespace)
    const tagPrefix = tagKeyPrefix(namespace)
    let removed = 0
    const prunes = new Map<string, Map<string, string | null>>()

    const flush = async () => {
      const batch = entries.splice(0, entries.length)
      await mapLimit(batch, config.concurrency, async ({ physicalKey }) => {
        const outcome = await removeCurrent(physicalKey, (record) => match(record))
        if (outcome.removedRecord) {
          removed += 1
          exactPrunes(physicalKey, outcome.removedRecord, prunes)
        }
      })
    }

    await gateway.scan(async (storedKey, value) => {
      if (storedKey.startsWith(entryPrefix)) {
        const record = decodeEntryRecord(value)
        if (!match(record)) return
        entries.push({ physicalKey: storedKey.slice(entryPrefix.length), record })
        if (entries.length >= config.iteratorBatchSize) await flush()
      } else if (storedKey.startsWith(tagPrefix)) {
        shardKeys.push(storedKey)
      }
    })
    await flush()
    await pruneQuietly(prunes)
    return { removed, shardKeys }
  }

  async function collectGarbage(shardKeys: string[]): Promise<void> {
    await mapLimit(shardKeys, config.concurrency, async (shardKey) => {
      try {
        const current = await gateway.getVersioned('tag index read', shardKey)
        if (!current) return
        const shard = decodeTagShard(current.value)
        if (!shard) return
        const observedAt = now()
        const expected = new Map<string, string | null>()
        for (const [physicalKey, member] of shard) {
          if (isMemberReclaimable(member, observedAt, graceMs)) {
            expected.set(physicalKey, member.writeId)
            continue
          }
          if (member.writtenAt + graceMs >= observedAt) continue
          const entry = await readEntry(physicalKey)
          const observedWriteId = entry.state === 'ok' ? entry.record.writeId : null
          if (observedWriteId !== member.writeId) expected.set(physicalKey, member.writeId)
        }
        if (expected.size > 0) await removeMembers(shardKey, expected)
      } catch (error) {
        logger.warn('tag index garbage collection deferred', { error })
      }
    })
  }

  async function scanEntries(visit: (physicalKey: string, value: unknown) => void): Promise<void> {
    const prefix = entryKeyPrefix(namespace)
    await gateway.scan((storedKey, value) => {
      if (storedKey.startsWith(prefix)) visit(storedKey.slice(prefix.length), value)
    })
  }

  return {
    async get(key: string, _options?: CacheGetOptions) {
      const result = await readLive(key)
      return result.found ? result.value : null
    },

    async set(key: string, value: CacheValue, setOptions?: CacheSetOptions) {
      const ttl = setOptions?.ttl ?? context.defaultTtl
      const ttlMs = typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? ttl : null
      const tags = uniqueTags(setOptions?.tags)
      const encoded = helpers.encode(JSON.stringify(value === undefined ? null : value))
      const encoding: EntryRecord['encoding'] = typeof encoded === 'string' ? 'text' : 'base64'
      const payload = typeof encoded === 'string' ? encoded : Buffer.from(encoded).toString('base64')
      if (Buffer.byteLength(payload, 'utf8') > config.maxValueBytes || tags.length > config.maxTagsPerEntry) {
        logger.warn('cache entry exceeds configured limits and was not stored', {
          bytes: Buffer.byteLength(payload, 'utf8'),
          tagCount: tags.length,
        })
        await removeCurrent(key, () => true).then((outcome) => {
          if (outcome.removedRecord) return pruneQuietly(exactPrunes(key, outcome.removedRecord))
          return undefined
        })
        return
      }
      const writtenAt = now()
      const record: EntryRecord = {
        writeId: createWriteId(),
        tags,
        expiresAt: ttlMs === null ? null : writtenAt + ttlMs,
        encoding,
        payload,
      }
      const member: TagMember = { writeId: record.writeId, writtenAt, expiresAt: record.expiresAt }
      await mapLimit(indexedTags(key, tags), config.concurrency, (tag) => addMember(tag, key, member))
      if (now() - writtenAt > writeDeadlineMs) {
        throw new CacheProviderError('timeout', `Cache provider "${PROVIDER_ID}" set exceeded its tag index write window`, { providerId: PROVIDER_ID })
      }
      await gateway.run('put', (client) => client.put(entryKey(namespace, key), encodeEntryRecord(record), lifespan(ttlMs)))
    },

    async has(key: string) {
      return (await readLive(key)).found
    },

    async delete(key: string) {
      for (let attempt = 0; attempt < config.maxCasAttempts; attempt++) {
        const entry = await readEntry(key)
        if (entry.state === 'missing') return false
        if (entry.state === 'corrupt') return discardCorrupt(key, entry.version)
        const removed = await gateway.run('remove', (client) => client.removeWithVersion(entryKey(namespace, key), entry.version))
        if (removed) {
          await pruneQuietly(exactPrunes(key, entry.record))
          return true
        }
      }
      throw contention('delete')
    },

    deleteByTags,

    async clear() {
      const { removed } = await removeAllMatching(() => true)
      return removed
    },

    async keys(pattern?: string) {
      const found: string[] = []
      await scanEntries((physicalKey) => {
        if (pattern && !helpers.matchPattern(physicalKey, pattern)) return
        found.push(physicalKey)
      })
      return found
    },

    async stats() {
      let size = 0
      let expired = 0
      const at = now()
      await scanEntries((_physicalKey, value) => {
        size += 1
        const record = decodeEntryRecord(value)
        if (record && record.expiresAt !== null && record.expiresAt <= at) expired += 1
      })
      return { size, expired }
    },

    async cleanup() {
      const at = now()
      const { removed, shardKeys } = await removeAllMatching((record) => record !== null && record.expiresAt !== null && record.expiresAt <= at)
      await collectGarbage(shardKeys)
      return removed
    },

    async healthcheck() {
      await gateway.run('healthcheck', (client) => client.containsKey(healthKey))
    },

    async close() {
      await gateway.close()
    },
  }
}
