export type CacheValue = unknown

export type CacheEntry = {
  key: string
  value: CacheValue
  tags: string[]
  expiresAt: number | null
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
  }>

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
}
