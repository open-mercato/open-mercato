import type { CacheStrategy, CacheEntry, CacheGetOptions, CacheSetOptions, CacheValue } from '../types'
import fs from 'node:fs'
import path from 'node:path'

/**
 * JSON file cache strategy with tag support
 * Persistent across process restarts, stored in JSON files
 * Simple and requires no external dependencies, but not suitable for high-performance scenarios
 */
export function createJsonFileStrategy(filePath?: string, options?: { defaultTtl?: number }): CacheStrategy {
  const defaultTtl = options?.defaultTtl
  const cacheFile = filePath || process.env.CACHE_JSON_FILE_PATH || '.cache.json'
  const dir = path.dirname(cacheFile)

  type StorageData = {
    entries: Record<string, CacheEntry>
    tagIndex: Record<string, string[]> // tag -> array of keys
  }

  function ensureDir(): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  function readData(): StorageData {
    ensureDir()
    if (!fs.existsSync(cacheFile)) {
      return { entries: {}, tagIndex: {} }
    }
    try {
      const content = fs.readFileSync(cacheFile, 'utf8')
      return JSON.parse(content) as StorageData
    } catch {
      return { entries: {}, tagIndex: {} }
    }
  }

  function writeData(data: StorageData): void {
    ensureDir()
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8')
  }

  function isExpired(entry: CacheEntry): boolean {
    if (entry.expiresAt === null) return false
    return Date.now() > entry.expiresAt
  }

  function matchPattern(key: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(key)
  }

  function addToTagIndex(data: StorageData, key: string, tags: string[]): void {
    for (const tag of tags) {
      if (!data.tagIndex[tag]) {
        data.tagIndex[tag] = []
      }
      if (!data.tagIndex[tag].includes(key)) {
        data.tagIndex[tag].push(key)
      }
    }
  }

  function removeFromTagIndex(data: StorageData, key: string, tags: string[]): void {
    for (const tag of tags) {
      if (data.tagIndex[tag]) {
        data.tagIndex[tag] = data.tagIndex[tag].filter((k) => k !== key)
        if (data.tagIndex[tag].length === 0) {
          delete data.tagIndex[tag]
        }
      }
    }
  }

  const get = async (key: string, options?: CacheGetOptions): Promise<CacheValue | null> => {
    const data = readData()
    const entry = data.entries[key]

    if (!entry) return null

    if (isExpired(entry)) {
      if (options?.returnExpired) {
        return entry.value
      }
      // Clean up expired entry
      removeFromTagIndex(data, key, entry.tags)
      delete data.entries[key]
      writeData(data)
      return null
    }

    return entry.value
  }

  const set = async (key: string, value: CacheValue, options?: CacheSetOptions): Promise<void> => {
    const data = readData()

    // Remove old entry from tag index if it exists
    const oldEntry = data.entries[key]
    if (oldEntry) {
      removeFromTagIndex(data, key, oldEntry.tags)
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

    data.entries[key] = entry
    addToTagIndex(data, key, tags)

    writeData(data)
  }

  const has = async (key: string): Promise<boolean> => {
    const data = readData()
    const entry = data.entries[key]

    if (!entry) return false

    if (isExpired(entry)) {
      removeFromTagIndex(data, key, entry.tags)
      delete data.entries[key]
      writeData(data)
      return false
    }

    return true
  }

  const deleteKey = async (key: string): Promise<boolean> => {
    const data = readData()
    const entry = data.entries[key]

    if (!entry) return false

    removeFromTagIndex(data, key, entry.tags)
    delete data.entries[key]
    writeData(data)

    return true
  }

  const deleteByTags = async (tags: string[]): Promise<number> => {
    const data = readData()
    const keysToDelete = new Set<string>()

    // Collect all keys that have any of the specified tags
    for (const tag of tags) {
      const keys = data.tagIndex[tag] || []
      for (const key of keys) {
        keysToDelete.add(key)
      }
    }

    // Delete all collected keys
    for (const key of keysToDelete) {
      const entry = data.entries[key]
      if (entry) {
        removeFromTagIndex(data, key, entry.tags)
        delete data.entries[key]
      }
    }

    writeData(data)
    return keysToDelete.size
  }

  const clear = async (): Promise<number> => {
    const data = readData()
    const size = Object.keys(data.entries).length

    writeData({ entries: {}, tagIndex: {} })

    return size
  }

  const keys = async (pattern?: string): Promise<string[]> => {
    const data = readData()
    const allKeys = Object.keys(data.entries)

    if (!pattern) return allKeys

    return allKeys.filter((key) => matchPattern(key, pattern))
  }

  const stats = async (): Promise<{ size: number; expired: number }> => {
    const data = readData()
    const allEntries = Object.values(data.entries)

    let expired = 0
    for (const entry of allEntries) {
      if (isExpired(entry)) {
        expired++
      }
    }

    return { size: allEntries.length, expired }
  }

  const cleanup = async (): Promise<number> => {
    const data = readData()
    let removed = 0

    const keysToRemove: string[] = []
    for (const [key, entry] of Object.entries(data.entries)) {
      if (isExpired(entry)) {
        keysToRemove.push(key)
      }
    }

    for (const key of keysToRemove) {
      const entry = data.entries[key]
      removeFromTagIndex(data, key, entry.tags)
      delete data.entries[key]
      removed++
    }

    if (removed > 0) {
      writeData(data)
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
