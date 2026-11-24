import type { CacheGetOptions, CacheSetOptions, CacheStrategy, CacheValue } from '@open-mercato/cache/types'
import type { CacheProviderHelpers, CacheProviderLogger } from '@open-mercato/cache/provider'
import type { RespClient, RespManagedClient } from './client'
import { isClusterClient } from './cluster'
import { buildRespKeyLayout, RESP_LAYOUT_VERSION } from './layout'
import type { RespKeyLayout } from './layout'
import { DELETE_IF_UNCHANGED, REAP_TAG_MEMBERS, sha1Hex } from './scripts'
import type { RespScript } from './scripts'
import { RESP_DEFAULTS } from './settings'

export type RespCacheStrategyTimeouts = {
  /** Upper bound for establishing the first connection inside `createRespCacheStrategy`. */
  connectMs?: number
}

export type RespCacheStrategyOptions = {
  namespace: string
  helpers: CacheProviderHelpers
  logger?: CacheProviderLogger
  defaultTtl?: number
  /** SCAN/SSCAN COUNT hint and the number of entries per MGET/script call. */
  batchSize?: number
  /** Encoded entries above this size are not stored; the previous value is removed instead. */
  maxValueBytes?: number
  timeouts?: RespCacheStrategyTimeouts
  /** Attempts for multi-key commands answered with TRYAGAIN during cluster slot migration (50 ms apart). */
  tryAgainAttempts?: number
}

export type RespCacheStrategy = CacheStrategy & {
  healthcheck(): Promise<void>
  cleanup(): Promise<number>
  close(): Promise<void>
}

export type RespStrategyClientFactory = () => RespClient | RespManagedClient | Promise<RespClient | RespManagedClient>

type RespEntry = {
  v: typeof RESP_LAYOUT_VERSION
  value: CacheValue
  tags: string[]
  expiresAt: number | null
}

type Deletion = { valueKey: string; member: string; digest: string; tagKeys: string[] }
type StaleMember = { valueKey: string; member: string; digest: string }

const NO_LOGGER: CacheProviderLogger = { warn() {}, error() {} }

function isManagedClient(value: RespClient | RespManagedClient): value is RespManagedClient {
  return typeof (value as RespManagedClient).dispose === 'function' && 'client' in value
}

function isRespEntry(value: unknown): value is RespEntry {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.v === RESP_LAYOUT_VERSION
    && 'value' in record
    && Array.isArray(record.tags)
    && record.tags.every((tag) => typeof tag === 'string')
    && (record.expiresAt === null || typeof record.expiresAt === 'number')
}

function uniqueTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return Array.from(new Set(tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)))
}

function isNoScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('NOSCRIPT')
}

const TRY_AGAIN_DELAY_MS = 50

function isTryAgainError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message.includes('TRYAGAIN')) return true
  const previous = (error as { previousErrors?: unknown }).previousErrors
  return Array.isArray(previous) && previous.some((entry) => entry instanceof Error && entry.message.includes('TRYAGAIN'))
}

/**
 * Multi-key commands (MULTI, scripts, MGET) get TRYAGAIN while their slot is
 * being migrated between cluster nodes. Retry them for a bounded number of
 * attempts; single-key commands are redirected by the client itself.
 */
async function retryTryAgain<T>(attempts: number, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isTryAgainError(error) || attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, TRY_AGAIN_DELAY_MS))
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function waitUntilReady(client: RespClient): Promise<void> {
  if (client.status === 'ready') return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const onReady = () => {
      client.off('end', onEnd)
      resolve()
    }
    const onEnd = () => {
      client.off('ready', onReady)
      reject(new Error('[internal] RESP connection ended before it became ready'))
    }
    client.once('ready', onReady)
    client.once('end', onEnd)
  })
}

async function connectClient(client: RespClient, timeoutMs: number): Promise<void> {
  if (client.status === 'ready') return
  const connecting = client.status === 'wait' ? client.connect().then(() => waitUntilReady(client)) : waitUntilReady(client)
  await withTimeout(connecting, timeoutMs, `[internal] RESP connection was not ready within ${timeoutMs}ms`)
}

/**
 * CacheStrategy over a RESP (Redis protocol) server for already tenant-scoped
 * physical keys.
 *
 * Layout (version 1), with `<ns>` the deployment namespace:
 * - `om:{<ns>}:v:<physicalKey>` holds the encoded entry `{ v, value, tags, expiresAt }`
 *   with a native `PX` TTL;
 * - `om:{<ns>}:t:<tag>` is a set of physical keys indexed under that tag.
 *
 * The `{<ns>}` hash tag puts every key of a namespace in one cluster slot so a
 * value and its tag sets can be written in one MULTI and compared/deleted in one
 * script. The trade-off: one namespace never spreads across cluster shards.
 */
export async function createRespCacheStrategy(
  clientFactory: RespStrategyClientFactory,
  options: RespCacheStrategyOptions,
): Promise<RespCacheStrategy> {
  const layout: RespKeyLayout = buildRespKeyLayout(options.namespace)
  const helpers = options.helpers
  const logger = options.logger ?? NO_LOGGER
  const batchSize = options.batchSize ?? RESP_DEFAULTS.batchSize
  const maxValueBytes = options.maxValueBytes ?? RESP_DEFAULTS.maxValueBytes
  const connectMs = options.timeouts?.connectMs ?? RESP_DEFAULTS.connectTimeoutMs
  const defaultTtl = options.defaultTtl
  const tryAgainAttempts = Math.max(1, options.tryAgainAttempts ?? RESP_DEFAULTS.tryAgainAttempts)

  const created = await clientFactory()
  const client = isManagedClient(created) ? created.client : created
  const dispose = isManagedClient(created) ? () => created.dispose() : () => undefined

  try {
    await connectClient(client, connectMs)
  } catch (error) {
    dispose()
    client.disconnect()
    throw error
  }

  async function runScript(script: RespScript, keys: string[], args: Array<string | Buffer>): Promise<number> {
    const result = await retryTryAgain(tryAgainAttempts, async (): Promise<unknown> => {
      try {
        return await client.evalsha(script.sha, keys.length, ...keys, ...args)
      } catch (error) {
        if (!isNoScriptError(error)) throw error
        return client.eval(script.source, keys.length, ...keys, ...args)
      }
    })
    return typeof result === 'number' ? result : Number(result ?? 0)
  }

  async function scanEach(match: string, visit: (keys: string[]) => Promise<void>): Promise<void> {
    const nodes = isClusterClient(client) ? client.nodes('master') : [client]
    for (const node of nodes) {
      let cursor = '0'
      do {
        const [next, keys] = await node.scan(cursor, 'MATCH', match, 'COUNT', batchSize)
        cursor = next
        if (keys.length > 0) await visit(keys)
      } while (cursor !== '0')
    }
  }

  async function sscanEach(key: string, visit: (members: string[]) => Promise<void>): Promise<void> {
    let cursor = '0'
    do {
      const [next, members] = await client.sscan(key, cursor, 'COUNT', batchSize)
      cursor = next
      if (members.length > 0) await visit(members)
    } while (cursor !== '0')
  }

  function decodeEntry(raw: Buffer): RespEntry | null {
    try {
      const parsed: unknown = JSON.parse(helpers.decode(raw))
      return isRespEntry(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  async function deleteIfUnchanged(deletions: Deletion[]): Promise<number> {
    if (deletions.length === 0) return 0
    const keys: string[] = []
    const args: string[] = []
    for (const deletion of deletions) {
      keys.push(deletion.valueKey, ...deletion.tagKeys)
      args.push(deletion.digest, deletion.member, String(deletion.tagKeys.length))
    }
    return runScript(DELETE_IF_UNCHANGED, keys, args)
  }

  async function reapMembers(tagKey: string, stale: StaleMember[]): Promise<number> {
    if (stale.length === 0) return 0
    return runScript(
      REAP_TAG_MEMBERS,
      [tagKey, ...stale.map((entry) => entry.valueKey)],
      stale.flatMap((entry) => [entry.member, entry.digest]),
    )
  }

  async function readEntry(key: string): Promise<RespEntry | null> {
    const valueKey = layout.valueKey(key)
    const raw = await client.getBuffer(valueKey)
    if (!raw) return null
    const entry = decodeEntry(raw)
    if (entry) return entry
    logger.warn('dropping undecodable cache entry')
    await deleteIfUnchanged([{ valueKey, member: key, digest: sha1Hex(raw), tagKeys: [] }])
    return null
  }

  async function readValues(valueKeys: string[]): Promise<Array<Buffer | null>> {
    return retryTryAgain(tryAgainAttempts, () => client.mgetBuffer(...valueKeys))
  }

  async function invalidateMembers(tagKey: string, members: string[], wanted: Set<string>): Promise<number> {
    const valueKeys = members.map((member) => layout.valueKey(member))
    const raws = await readValues(valueKeys)
    const deletions: Deletion[] = []
    const stale: StaleMember[] = []
    members.forEach((member, index) => {
      const valueKey = valueKeys[index]
      const raw = raws[index]
      if (!raw) {
        stale.push({ valueKey, member, digest: '' })
        return
      }
      const digest = sha1Hex(raw)
      const entry = decodeEntry(raw)
      if (!entry) {
        deletions.push({ valueKey, member, digest, tagKeys: [tagKey] })
        return
      }
      if (entry.tags.some((tag) => wanted.has(tag))) {
        const tagKeys = new Set(entry.tags.map((tag) => layout.tagKey(tag)))
        tagKeys.add(tagKey)
        deletions.push({ valueKey, member, digest, tagKeys: Array.from(tagKeys) })
        return
      }
      stale.push({ valueKey, member, digest })
    })
    const removed = await deleteIfUnchanged(deletions)
    await reapMembers(tagKey, stale)
    return removed
  }

  async function unlinkAll(match: string): Promise<number> {
    let removed = 0
    await scanEach(match, async (keys) => {
      removed += await client.unlink(...keys)
    })
    return removed
  }

  let closing: Promise<void> | null = null

  return {
    async get(key: string, _options?: CacheGetOptions) {
      const entry = await readEntry(key)
      return entry ? entry.value : null
    },

    async set(key: string, value: CacheValue, setOptions?: CacheSetOptions) {
      const valueKey = layout.valueKey(key)
      const ttl = setOptions?.ttl ?? defaultTtl
      const ttlMs = typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? Math.ceil(ttl) : null
      const tags = uniqueTags(setOptions?.tags)
      const entry: RespEntry = {
        v: RESP_LAYOUT_VERSION,
        value: value === undefined ? null : value,
        tags,
        expiresAt: ttlMs !== null ? Date.now() + ttlMs : null,
      }
      const payload = helpers.encode(JSON.stringify(entry))
      const size = typeof payload === 'string' ? Buffer.byteLength(payload) : payload.length
      if (size > maxValueBytes) {
        await client.del(valueKey)
        logger.warn('cache entry exceeds maxValueBytes; previous value removed and the write skipped', { bytes: size, limit: maxValueBytes })
        return
      }
      await retryTryAgain(tryAgainAttempts, async () => {
        const transaction = client.multi()
        if (ttlMs !== null) transaction.set(valueKey, payload, 'PX', ttlMs)
        else transaction.set(valueKey, payload)
        for (const tag of tags) transaction.sadd(layout.tagKey(tag), key)
        const results = await transaction.exec()
        if (!results) throw new Error('[internal] RESP cache write transaction was discarded')
        for (const [error] of results) {
          if (error) throw error
        }
      })
    },

    async has(key: string) {
      return (await readEntry(key)) !== null
    },

    async delete(key: string) {
      return (await client.del(layout.valueKey(key))) > 0
    },

    async deleteByTags(tags: string[]) {
      const wantedTags = uniqueTags(tags)
      if (wantedTags.length === 0) return 0
      const wanted = new Set(wantedTags)
      const handled = new Set<string>()
      let removed = 0
      for (const tag of wantedTags) {
        const tagKey = layout.tagKey(tag)
        await sscanEach(tagKey, async (members) => {
          const fresh = members.filter((member) => !handled.has(member))
          for (const member of fresh) handled.add(member)
          for (let start = 0; start < fresh.length; start += batchSize) {
            removed += await invalidateMembers(tagKey, fresh.slice(start, start + batchSize), wanted)
          }
        })
      }
      return removed
    },

    async clear() {
      const removed = await unlinkAll(layout.valueScanPattern())
      await unlinkAll(layout.tagScanPattern())
      return removed
    },

    async keys(pattern?: string) {
      const found = new Set<string>()
      await scanEach(layout.valueScanPattern(pattern), async (valueKeys) => {
        for (const valueKey of valueKeys) {
          const physicalKey = layout.physicalKeyFromValueKey(valueKey)
          if (physicalKey === null) continue
          if (pattern && !helpers.matchPattern(physicalKey, pattern)) continue
          found.add(physicalKey)
        }
      })
      return Array.from(found)
    },

    async stats() {
      const found = new Set<string>()
      await scanEach(layout.valueScanPattern(), async (valueKeys) => {
        for (const valueKey of valueKeys) found.add(valueKey)
      })
      return { size: found.size, expired: 0 }
    },

    async cleanup() {
      await scanEach(layout.tagScanPattern(), async (tagKeys) => {
        for (const tagKey of tagKeys) {
          await sscanEach(tagKey, async (members) => {
            const valueKeys = members.map((member) => layout.valueKey(member))
            const raws = await readValues(valueKeys)
            const missing: StaleMember[] = []
            raws.forEach((raw, index) => {
              if (!raw) missing.push({ valueKey: valueKeys[index], member: members[index], digest: '' })
            })
            await reapMembers(tagKey, missing)
          })
        }
      })
      return 0
    },

    async healthcheck() {
      if (closing || client.status === 'end') throw new Error('[internal] RESP cache client is closed')
      const reply = await client.ping()
      if (reply !== 'PONG') throw new Error('[internal] RESP cache healthcheck returned an unexpected reply')
    },

    close() {
      if (!closing) {
        closing = (async () => {
          dispose()
          if (client.status === 'end') return
          try {
            await client.quit()
          } catch {
            client.disconnect()
          }
        })()
      }
      return closing
    },
  }
}
