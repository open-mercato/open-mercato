import type { HotRodClient, HotRodConnector, HotRodIterator, HotRodStoreOptions } from '../../client'

type StoredValue = { value: string; version: bigint; expiresAt: number | null }

export type FakeHotRodStore = {
  entries: Map<string, StoredValue>
  connector: HotRodConnector
  connections: number
  failNext: number
  hangNext: number
  raw(key: string): string | undefined
  setRaw(key: string, value: string): void
}

function parseLifespan(options?: HotRodStoreOptions): number | null {
  if (!options?.lifespan) return null
  const match = /^(\d+)ms$/.exec(options.lifespan)
  if (!match) throw new Error('[internal] fake hot rod expects millisecond lifespans')
  return Date.now() + Number(match[1])
}

function versionBuffer(version: bigint): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(version)
  return buffer
}

export function createFakeHotRodStore(): FakeHotRodStore {
  const entries = new Map<string, StoredValue>()
  let nextVersion = 1n
  const live = (key: string): StoredValue | undefined => {
    const stored = entries.get(key)
    if (!stored) return undefined
    if (stored.expiresAt !== null && stored.expiresAt <= Date.now()) {
      entries.delete(key)
      return undefined
    }
    return stored
  }
  const write = (key: string, value: string, options?: HotRodStoreOptions) => {
    entries.set(key, { value, version: nextVersion++, expiresAt: parseLifespan(options) })
  }
  const store: FakeHotRodStore = {
    entries,
    connections: 0,
    failNext: 0,
    hangNext: 0,
    raw: (key) => live(key)?.value,
    setRaw: (key, value) => write(key, value),
    connector: async () => {
      store.connections += 1
      let disconnected = false
      const guard = async <T>(body: () => T): Promise<T> => {
        await Promise.resolve()
        if (disconnected) throw new Error('disconnected')
        if (store.hangNext > 0) {
          store.hangNext -= 1
          return new Promise<T>(() => undefined)
        }
        if (store.failNext > 0) {
          store.failNext -= 1
          throw new Error('socket reset')
        }
        return body()
      }
      const client: HotRodClient = {
        get: (key) => guard(() => live(key)?.value),
        getWithMetadata: (key) => guard(() => {
          const stored = live(key)
          return stored ? { value: stored.value, version: versionBuffer(stored.version) } : undefined
        }),
        getAll: (keys) => guard(() => keys.flatMap((key) => {
          const stored = live(key)
          return stored ? [{ key, value: stored.value }] : []
        })),
        containsKey: (key) => guard(() => live(key) !== undefined),
        put: (key, value, options) => guard(() => { write(key, value, options) }),
        putIfAbsent: (key, value, options) => guard(() => {
          if (live(key)) return false
          write(key, value, options)
          return true
        }),
        replaceWithVersion: (key, value, version, options) => guard(() => {
          const stored = live(key)
          if (!stored || !versionBuffer(stored.version).equals(version)) return false
          write(key, value, options)
          return true
        }),
        remove: (key) => guard(() => entries.delete(key)),
        removeWithVersion: (key, version) => guard(() => {
          const stored = live(key)
          if (!stored || !versionBuffer(stored.version).equals(version)) return false
          entries.delete(key)
          return true
        }),
        iterator: (batchSize) => guard((): HotRodIterator => {
          const snapshot = Array.from(entries.keys())
          let cursor = 0
          return {
            next: async () => {
              while (cursor < snapshot.length) {
                const key = snapshot[cursor++]
                const stored = live(key)
                if (stored) return { done: false, key, value: stored.value, version: versionBuffer(stored.version) }
              }
              return { done: true }
            },
            close: async () => batchSize,
          }
        }),
        disconnect: async () => { disconnected = true },
      }
      return client
    },
  }
  return store
}
