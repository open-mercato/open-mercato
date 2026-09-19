import { parseNumberWithDefault } from '../number'

export type BoundedTtlMemo<V> = {
  get(key: string): V | undefined
  set(key: string, value: V): void
  clear(): void
  size(): number
}

export type BoundedTtlMemoOptions = {
  ttlEnv: string
  maxEntriesEnv: string
  defaultTtlMs: number
  defaultMaxEntries: number
}

/**
 * A `{ value, expiresAt }` map with amortized eviction: on overflow, expired entries are swept
 * first, and only if the cap is still exceeded is the map cleared wholesale. `TTL=0` disables
 * storage — `set` becomes a no-op and every `get` misses.
 */
export function createBoundedTtlMemo<V>(options: BoundedTtlMemoOptions): BoundedTtlMemo<V> {
  const store = new Map<string, { value: V; expiresAt: number }>()

  const resolveTtlMs = (): number => parseNumberWithDefault(process.env[options.ttlEnv], options.defaultTtlMs, { integer: true, min: 0 })
  const resolveMaxEntries = (): number => parseNumberWithDefault(process.env[options.maxEntriesEnv], options.defaultMaxEntries, { integer: true, min: 1 })

  return {
    get(key) {
      const entry = store.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= Date.now()) return undefined
      return entry.value
    },
    set(key, value) {
      const ttlMs = resolveTtlMs()
      if (ttlMs <= 0) return
      const maxEntries = resolveMaxEntries()
      if (store.size >= maxEntries) {
        const now = Date.now()
        for (const [entryKey, entry] of store) {
          if (entry.expiresAt <= now) store.delete(entryKey)
        }
        if (store.size >= maxEntries) store.clear()
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
    },
    clear() {
      store.clear()
    },
    size() {
      return store.size
    },
  }
}
