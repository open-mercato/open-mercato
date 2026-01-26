/**
 * Redis connection helper for BullMQ
 * 
 * BullMQ expects connection options as an object, not a URL string directly.
 * This helper parses Redis URLs into the format BullMQ expects.
 */

export interface RedisConnectionOptions {
  host: string
  port: number
  password?: string
  db?: number
}

/**
 * Get Redis URL from environment variables
 */
export function getRedisUrl(): string {
  return process.env.REDIS_URL || process.env.QUEUE_REDIS_URL || 'redis://localhost:6379'
}

/**
 * Parse Redis URL into connection options for BullMQ
 * 
 * @param url - Redis URL (e.g., redis://user:password@host:port/db)
 * @returns Connection options object compatible with BullMQ
 */
export function parseRedisUrl(url: string): RedisConnectionOptions {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port, 10) || 6379,
      password: parsed.password || undefined,
      db: parsed.pathname ? parseInt(parsed.pathname.slice(1), 10) || undefined : undefined,
    }
  } catch {
    // Fallback for simple host:port strings or malformed URLs
    return { host: 'localhost', port: 6379 }
  }
}

/**
 * Get Redis connection options from environment
 */
export function getRedisConnection(): RedisConnectionOptions {
  return parseRedisUrl(getRedisUrl())
}
