import { MemcachedConnection } from './connection'
import { MemcachedProtocolError } from './errors'
import type { MemcachedTransport } from './transport'
import {
  addCommand,
  casCommand,
  getsCommand,
  metaDeleteCommand,
  metaGetCommand,
  metaGetManyCommand,
  metaSetCommand,
  noopCommand,
  statsCommand,
  versionCommand,
  type ClassicStoreOptions,
  type ClassicStoreOutcome,
  type EncodedCommand,
  type MemcachedItem,
  type MetaDeleteOutcome,
  type MetaSetOptions,
  type MetaSetOutcome,
} from './commands'

export const MAX_COMMAND_BYTES = 16 * 1024
export const DEFAULT_POOL_SIZE = 2
export const DEFAULT_CONNECT_TIMEOUT_MS = 2_000
export const DEFAULT_COMMAND_TIMEOUT_MS = 2_000

export type MemcachedClientOptions = {
  transport: MemcachedTransport
  poolSize?: number
  connectTimeoutMs?: number
  commandTimeoutMs?: number
  /** Upper bound for the command bytes of one batched request (default and maximum 16 KiB). */
  maxCommandBytes?: number
  /** Upper bound for the number of keys fetched by one batched request. */
  maxKeysPerBatch?: number
}

export type MemcachedCommandName = 'mg' | 'ms' | 'md' | 'mn' | 'gets' | 'add' | 'cas' | 'version' | 'stats'

export type MemcachedClient = {
  metaGet(key: string): Promise<MemcachedItem | null>
  metaGetMany(keys: string[]): Promise<Map<string, MemcachedItem>>
  metaSet(key: string, value: Buffer, options?: MetaSetOptions): Promise<MetaSetOutcome>
  metaDelete(key: string, options?: { cas?: string }): Promise<MetaDeleteOutcome>
  gets(keys: string[]): Promise<Map<string, MemcachedItem>>
  add(key: string, value: Buffer, options?: ClassicStoreOptions): Promise<ClassicStoreOutcome>
  cas(key: string, value: Buffer, cas: string, options?: ClassicStoreOptions): Promise<ClassicStoreOutcome>
  noop(): Promise<void>
  version(): Promise<string>
  stats(group?: string): Promise<Map<string, string>>
  commandCounts(): Record<MemcachedCommandName, number>
  describe(): string
  close(): Promise<void>
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new MemcachedProtocolError('protocol_error', `Memcached client option must be an integer between ${min} and ${max}`)
  }
  return value
}

/**
 * Splits keys into batches whose pipelined command text stays within
 * `maxCommandBytes` and whose key count stays within `maxKeys`.
 */
export function planKeyBatches(keys: string[], lineBytes: (key: string) => number, maxCommandBytes: number, maxKeys: number): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let currentBytes = 0
  for (const key of keys) {
    const bytes = lineBytes(key)
    if (bytes > maxCommandBytes) {
      throw new MemcachedProtocolError('command_too_large', 'A single memcached key exceeds the command size limit')
    }
    if (current.length > 0 && (currentBytes + bytes > maxCommandBytes || current.length >= maxKeys)) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(key)
    currentBytes += bytes
  }
  if (current.length > 0) batches.push(current)
  return batches
}

const META_GET_MANY_OVERHEAD = 'mg  v c f k q\r\n'.length
const META_GET_MANY_TERMINATOR = 'mn\r\n'.length
const GETS_OVERHEAD = 'gets\r\n'.length

export function createMemcachedClient(options: MemcachedClientOptions): MemcachedClient {
  const transport = options.transport
  const poolSize = boundedInteger(options.poolSize, DEFAULT_POOL_SIZE, 1, 64)
  const connectTimeoutMs = boundedInteger(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS, 1, 120_000)
  const commandTimeoutMs = boundedInteger(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, 1, 120_000)
  const maxCommandBytes = boundedInteger(options.maxCommandBytes, MAX_COMMAND_BYTES, 256, MAX_COMMAND_BYTES)
  const maxKeysPerBatch = boundedInteger(options.maxKeysPerBatch, 512, 1, 4096)
  const slots: Array<Promise<MemcachedConnection> | null> = Array.from({ length: poolSize }, () => null)
  const counts: Record<MemcachedCommandName, number> = {
    mg: 0, ms: 0, md: 0, mn: 0, gets: 0, add: 0, cas: 0, version: 0, stats: 0,
  }
  let cursor = 0
  let closed = false

  const openSlot = (index: number): Promise<MemcachedConnection> => {
    const opening = MemcachedConnection.open(transport, { connectTimeoutMs, commandTimeoutMs }).then(
      (connection) => {
        if (closed) {
          connection.close()
          throw new MemcachedProtocolError('closed', 'Memcached client is closed')
        }
        return connection
      },
      (error: unknown) => {
        if (slots[index] === opening) slots[index] = null
        throw error
      },
    )
    slots[index] = opening
    return opening
  }

  const acquire = async (): Promise<MemcachedConnection> => {
    if (closed) throw new MemcachedProtocolError('closed', 'Memcached client is closed')
    const index = cursor
    cursor = (cursor + 1) % poolSize
    const slot = slots[index]
    if (slot) {
      const connection = await slot.catch(() => null)
      if (connection && connection.alive) return connection
      if (slots[index] !== slot) return acquire()
    }
    return openSlot(index)
  }

  const run = async <T>(name: MemcachedCommandName, build: () => EncodedCommand<T>): Promise<T> => {
    const command = build()
    const connection = await acquire()
    counts[name] += 1
    return connection.send(command.payload, command.parse)
  }

  const runBatches = async <T>(
    batches: string[][],
    execute: (batch: string[]) => Promise<Map<string, T>>,
  ): Promise<Map<string, T>> => {
    const merged = new Map<string, T>()
    for (let start = 0; start < batches.length; start += poolSize) {
      const wave = batches.slice(start, start + poolSize)
      const results = await Promise.all(wave.map(execute))
      for (const result of results) for (const [key, item] of result) merged.set(key, item)
    }
    return merged
  }

  return {
    metaGet: (key) => run('mg', () => metaGetCommand(key)),
    async metaGetMany(keys) {
      const unique = Array.from(new Set(keys))
      if (unique.length === 0) return new Map()
      const batches = planKeyBatches(
        unique,
        (key) => key.length + META_GET_MANY_OVERHEAD,
        maxCommandBytes - META_GET_MANY_TERMINATOR,
        maxKeysPerBatch,
      )
      return runBatches(batches, (batch) => run('mg', () => metaGetManyCommand(batch)))
    },
    metaSet: (key, value, setOptions) => run('ms', () => metaSetCommand(key, value, setOptions)),
    metaDelete: (key, deleteOptions) => run('md', () => metaDeleteCommand(key, deleteOptions)),
    async gets(keys) {
      const unique = Array.from(new Set(keys))
      if (unique.length === 0) return new Map()
      const batches = planKeyBatches(unique, (key) => key.length + 1, maxCommandBytes - GETS_OVERHEAD, maxKeysPerBatch)
      return runBatches(batches, (batch) => run('gets', () => getsCommand(batch)))
    },
    add: (key, value, storeOptions) => run('add', () => addCommand(key, value, storeOptions)),
    cas: (key, value, cas, storeOptions) => run('cas', () => casCommand(key, value, cas, storeOptions)),
    async noop() {
      await run('mn', () => noopCommand())
    },
    version: () => run('version', () => versionCommand()),
    stats: (group) => run('stats', () => statsCommand(group)),
    commandCounts: () => ({ ...counts }),
    describe: () => transport.describe(),
    async close() {
      if (closed) return
      closed = true
      const pending = slots.splice(0, slots.length)
      await Promise.all(pending.map(async (slot) => {
        if (!slot) return
        const connection = await slot.catch(() => null)
        connection?.close()
      }))
    },
  }
}
