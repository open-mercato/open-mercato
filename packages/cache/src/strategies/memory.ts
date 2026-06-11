import type { CacheStrategy, CacheEntry, CacheGetOptions, CacheSetOptions, CacheValue } from '../types'
import { matchCacheKeyPattern } from '../patterns'

const DEFAULT_MAX_ENTRIES = 10_000
const EXPIRED_SWEEP_WRITE_INTERVAL = 256

function resolveMaxEntries(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit)
  }
  const raw = process.env?.CACHE_MAX_ENTRIES
  if (raw) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_MAX_ENTRIES
}

/**
 * In-memory cache strategy with tag support
 * Fast but data is lost when process restarts.
 *
 * Bounded by an LRU cap (`maxEntries`, default 10k, env-tunable via
 * `CACHE_MAX_ENTRIES`) so a process-shared instance (OM_BOOTSTRAP_CACHE,
 * long-lived workers, memory-backed CRUD list cache) cannot grow without
 * limit on user-controllable key cardinality. Recency is refreshed on read
 * (Map-reinsertion), oldest entries are evicted on write, and expired
 * entries are reclaimed by an amortized sweep every N writes — no
 * per-instance timer, so the per-request default stays leak-free.
 */
export function createMemoryStrategy(options?: { defaultTtl?: number; maxEntries?: number }): CacheStrategy {
  const store = new Map<string, CacheEntry>()
  const tagIndex = new Map<string, Set<string>>() // tag -> Set of keys
  const defaultTtl = options?.defaultTtl
  const maxEntries = resolveMaxEntries(options?.maxEntries)
  let writesSinceSweep = 0

  function isExpired(entry: CacheEntry): boolean {
    if (entry.expiresAt === null) return false
    return Date.now() > entry.expiresAt
  }

  function cleanupExpiredEntry(key: string, entry: CacheEntry): void {
    store.delete(key)
    // Remove from tag index
    for (const tag of entry.tags) {
      const keys = tagIndex.get(tag)
      if (keys) {
        keys.delete(key)
        if (keys.size === 0) {
          tagIndex.delete(tag)
        }
      }
    }
  }

  function addToTagIndex(key: string, tags: string[]): void {
    for (const tag of tags) {
      if (!tagIndex.has(tag)) {
        tagIndex.set(tag, new Set())
      }
      tagIndex.get(tag)!.add(key)
    }
  }

  function removeFromTagIndex(key: string, tags: string[]): void {
    for (const tag of tags) {
      const keys = tagIndex.get(tag)
      if (keys) {
        keys.delete(key)
        if (keys.size === 0) {
          tagIndex.delete(tag)
        }
      }
    }
  }

  // Move an entry to the most-recently-used position so eviction targets the
  // genuinely cold keys. Map preserves insertion order, so re-inserting the
  // key makes it the newest. tagIndex references the key, not its position,
  // so it stays consistent without touching it.
  function touchRecency(key: string, entry: CacheEntry): void {
    store.delete(key)
    store.set(key, entry)
  }

  // Amortized reclamation of already-expired entries. Runs every N writes
  // instead of on a timer, keeping the no-shared-state property that makes
  // the per-request default safe (a per-instance setInterval would pin every
  // request's Maps for the process lifetime).
  function sweepExpiredIfDue(): void {
    if (++writesSinceSweep < EXPIRED_SWEEP_WRITE_INTERVAL) return
    writesSinceSweep = 0
    for (const [key, entry] of store.entries()) {
      if (isExpired(entry)) {
        cleanupExpiredEntry(key, entry)
      }
    }
  }

  // Bound total size by evicting the oldest (least-recently-used) entries via
  // the tag-consistent removal primitive, never a bare store.delete.
  function evictIfNeeded(): void {
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value
      if (typeof oldestKey !== 'string') break
      const oldestEntry = store.get(oldestKey)
      if (!oldestEntry) {
        store.delete(oldestKey)
        continue
      }
      cleanupExpiredEntry(oldestKey, oldestEntry)
    }
  }

  const get = async (key: string, options?: CacheGetOptions): Promise<CacheValue | null> => {
    const entry = store.get(key)
    if (!entry) return null

    if (isExpired(entry)) {
      if (options?.returnExpired) {
        return entry.value
      }
      cleanupExpiredEntry(key, entry)
      return null
    }

    touchRecency(key, entry)
    return entry.value
  }

  const set = async (key: string, value: CacheValue, options?: CacheSetOptions): Promise<void> => {
    // Remove old entry from tag index if it exists
    const oldEntry = store.get(key)
    if (oldEntry) {
      removeFromTagIndex(key, oldEntry.tags)
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

    store.set(key, entry)
    addToTagIndex(key, tags)

    sweepExpiredIfDue()
    evictIfNeeded()
  }

  const has = async (key: string): Promise<boolean> => {
    const entry = store.get(key)
    if (!entry) return false
    if (isExpired(entry)) {
      cleanupExpiredEntry(key, entry)
      return false
    }
    return true
  }

  const deleteKey = async (key: string): Promise<boolean> => {
    const entry = store.get(key)
    if (!entry) return false

    removeFromTagIndex(key, entry.tags)
    return store.delete(key)
  }

  const deleteByTags = async (tags: string[]): Promise<number> => {
    const keysToDelete = new Set<string>()

    // Collect all keys that have any of the specified tags
    for (const tag of tags) {
      const keys = tagIndex.get(tag)
      if (keys) {
        for (const key of keys) {
          keysToDelete.add(key)
        }
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
    const size = store.size
    store.clear()
    tagIndex.clear()
    return size
  }

  const keys = async (pattern?: string): Promise<string[]> => {
    const allKeys = Array.from(store.keys())
    if (!pattern) return allKeys
    return allKeys.filter((key) => matchCacheKeyPattern(key, pattern))
  }

  const stats = async (): Promise<{ size: number; expired: number }> => {
    let expired = 0
    for (const entry of store.values()) {
      if (isExpired(entry)) {
        expired++
      }
    }
    return { size: store.size, expired }
  }

  const cleanup = async (): Promise<number> => {
    let removed = 0
    for (const [key, entry] of store.entries()) {
      if (isExpired(entry)) {
        cleanupExpiredEntry(key, entry)
        removed++
      }
    }
    return removed
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
  }
}
