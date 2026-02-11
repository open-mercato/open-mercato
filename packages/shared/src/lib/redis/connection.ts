/**
 * Shared Redis connection utilities.
 *
 * Every package that needs a Redis URL or parsed connection options
 * should import from here instead of reading env vars directly.
 *
 * The `prefix` parameter lets each subsystem define its own override:
 *   getRedisUrl('QUEUE')  → QUEUE_REDIS_URL  > REDIS_URL > localhost
 *   getRedisUrl('CACHE')  → CACHE_REDIS_URL  > REDIS_URL > localhost
 *   getRedisUrl()         → REDIS_URL > localhost
 */

export type ParsedRedisConnection = {
  host: string
  port: number
  password?: string
  db?: number
}

/**
 * Resolve a Redis URL from environment variables.
 *
 * Priority: <PREFIX>_REDIS_URL  →  REDIS_URL  →  redis://localhost:6379
 */
export function getRedisUrl(prefix?: string): string {
  if (prefix) {
    const prefixed = process.env[`${prefix}_REDIS_URL`]
    if (prefixed) return prefixed
  }
  return process.env.REDIS_URL || 'redis://localhost:6379'
}

/**
 * Parse a redis:// URL into a {host, port, password, db} object
 * suitable for BullMQ / ioredis structured connection options.
 */
export function parseRedisUrl(url: string): ParsedRedisConnection {
  try {
    const parsed = new URL(url)
    const dbStr = parsed.pathname ? parsed.pathname.slice(1) : ''
    const dbParsed = dbStr !== '' ? parseInt(dbStr, 10) : NaN
    const db = Number.isNaN(dbParsed) ? undefined : dbParsed
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port, 10) || 6379,
      password: parsed.password || undefined,
      db,
    }
  } catch {
    return { host: 'localhost', port: 6379 }
  }
}

/**
 * Convenience: resolve the URL from env and parse it in one step.
 */
export function resolveRedisConnection(prefix?: string): ParsedRedisConnection & { url: string } {
  const url = getRedisUrl(prefix)
  return { url, ...parseRedisUrl(url) }
}
