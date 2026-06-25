export type CacheValue = unknown

export type CacheEntry = {
  key: string
  value: CacheValue
  tags: string[]
  expiresAt: number | null
  /**
   * Wall-clock creation time. Informational/diagnostic only — LRU recency and
   * eviction rely purely on Map insertion order, not on this field.
   */
  createdAt: number
}

export type CacheOptions = {
  ttl?: number // Time to live in milliseconds
  tags?: string[] // Tags for invalidation
}

export type CacheGetOptions = {
  returnExpired?: boolean // Return expired values (default: false)
}

export type CacheSetOptions = CacheOptions

export type CacheStrategy = {
  /**
   * Get a value from cache
   * @param key - Cache key
   * @param options - Get options
   * @returns The cached value or null if not found or expired
   */
  get(key: string, options?: CacheGetOptions): Promise<CacheValue | null>

  /**
   * Set a value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param options - Cache options (ttl, tags)
   */
  set(key: string, value: CacheValue, options?: CacheSetOptions): Promise<void>

  /**
   * Check if a key exists in cache (and is not expired)
   * @param key - Cache key
   * @returns true if key exists and is not expired
   */
  has(key: string): Promise<boolean>

  /**
   * Delete a specific key from cache
   * @param key - Cache key
   * @returns true if key was deleted, false if not found
   */
  delete(key: string): Promise<boolean>

  /**
   * Delete all keys with specified tags
   * @param tags - Tags to match (any key with ANY of these tags will be deleted)
   * @returns Number of keys deleted
   */
  deleteByTags(tags: string[]): Promise<number>

  /**
   * Clear all cache entries
   * @returns Number of keys deleted
   */
  clear(): Promise<number>

  /**
   * Get all keys matching a pattern
   * @param pattern - Pattern to match (supports wildcards: * and ?)
   * @returns Array of matching keys
   */
  keys(pattern?: string): Promise<string[]>

  /**
   * Get cache statistics
   * @returns Statistics object
   */
  stats(): Promise<{
    size: number // Total number of entries
    expired: number // Number of expired entries
    // Optional process-global counters surfaced by bounded strategies (memory)
    // so operators can tell whether the LRU cap / sweep is actively protecting
    // the process. Strategies that do not track them omit these fields.
    evictions?: number // Entries dropped by LRU eviction since process start
    sweeps?: number // Amortized expired-entry sweep passes run since process start
    lastSweepReclaimed?: number // Entries reclaimed by the most recent sweep pass
  }>

  /**
   * Verify the configured backend is reachable without activating a fallback.
   */
  healthcheck?(): Promise<void>

  /**
   * Clean up expired entries (optional, some strategies may auto-cleanup)
   * @returns Number of entries removed
   */
  cleanup?(): Promise<number>

  /**
   * Close/disconnect the cache strategy
   */
  close?(): Promise<void>
}

export type CacheServiceOptions = {
  strategy?: 'memory' | 'redis' | 'sqlite' | 'jsonfile'
  redisUrl?: string
  sqlitePath?: string
  jsonFilePath?: string
  defaultTtl?: number
  /**
   * Upper bound on retained entries for the in-memory strategy (including the
   * memory fallback used when a native dependency is unavailable). Bounds
   * memory for process-wide instances via LRU eviction. Falls back to
   * `CACHE_MEMORY_MAX_ENTRIES` then a built-in default; a non-positive value
   * disables the cap.
   */
  maxEntries?: number
}
