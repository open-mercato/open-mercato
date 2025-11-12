import type { CacheStrategy, CacheEntry, CacheGetOptions, CacheSetOptions, CacheValue } from '../types'

/**
 * In-memory cache strategy with tag support
 * Fast but data is lost when process restarts
 */
export function createMemoryStrategy(options?: { defaultTtl?: number }): CacheStrategy {
  const store = new Map<string, CacheEntry>()
  const tagIndex = new Map<string, Set<string>>() // tag -> Set of keys
  const defaultTtl = options?.defaultTtl

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

  function matchPattern(key: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*/g, '.*') // * matches any characters
      .replace(/\?/g, '.') // ? matches single character
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(key)
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
    return allKeys.filter((key) => matchPattern(key, pattern))
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
