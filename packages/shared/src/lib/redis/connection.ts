import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'redis' })

/**
 * Shared Redis connection utilities.
 *
 * Every package that needs a Redis URL or parsed connection options
 * should import from here instead of reading env vars directly.
 *
 * The `prefix` parameter lets each subsystem define its own override:
 *   getRedisUrl('QUEUE')  → QUEUE_REDIS_URL  > REDIS_URL > null
 *   getRedisUrl('CACHE')  → CACHE_REDIS_URL  > REDIS_URL > null
 *   getRedisUrl()         → REDIS_URL > null
 *
 * Returns null when Redis is not configured so callers can explicitly
 * decide whether to fall back to a non-Redis strategy or fail loudly.
 * Use getRedisUrlOrThrow() when Redis is mandatory for the caller.
 */

export type ParsedRedisConnection = {
  host: string
  port: number
  username?: string
  password?: string
  db?: number
  tls?: Record<string, unknown>
  family?: number
  protocol?: RedisProtocolVersion
}

/**
 * RESP wire protocol version, mirroring ioredis' own `ProtocolVersion` union.
 * Declared locally because ioredis is an optional peer of the packages that
 * consume these options.
 */
export type RedisProtocolVersion = 2 | 3

/**
 * Wire protocol every Redis client in the monorepo negotiates.
 *
 * ioredis 6 switched its default from RESP2 to RESP3. RESP3 changes the reply
 * shape of map-style commands and delivers pub/sub over push frames instead of
 * ordinary replies, which neither BullMQ nor rate-limiter-flexible declare
 * support for. Pinning the protocol keeps the client byte-compatible with the
 * ioredis 5 behaviour the rest of the stack was built and tested against.
 * Adopting RESP3 is a deliberate, separately testable change — not a side
 * effect of a version bump.
 */
export const REDIS_WIRE_PROTOCOL: RedisProtocolVersion = 2

/**
 * Resolve a Redis URL from environment variables.
 *
 * Priority: <PREFIX>_REDIS_URL  →  REDIS_URL  →  null
 *
 * Returns null when no env var is set. Callers MUST NOT assume a
 * localhost default — silently connecting to localhost masks missing
 * configuration and stalls on platforms where nothing listens there
 * (e.g., WSL2 without a local Redis).
 */
export function getRedisUrl(prefix?: string): string | null {
  if (prefix) {
    const prefixed = process.env[`${prefix}_REDIS_URL`]
    if (prefixed) return prefixed
  }
  return process.env.REDIS_URL || null
}

/**
 * Like getRedisUrl, but throws a descriptive error when Redis is not
 * configured. Use from code paths that require Redis (e.g. BullMQ
 * async queue, Redis cache strategy, scheduler service).
 */
export function getRedisUrlOrThrow(prefix?: string): string {
  const url = getRedisUrl(prefix)
  if (url) return url
  const which = prefix ? `${prefix}_REDIS_URL or REDIS_URL` : 'REDIS_URL'
  throw new Error(
    `Redis URL is not configured. Set ${which} in your environment to use a Redis-backed strategy.`
  )
}

/**
 * Parse a redis:// URL into structured connection options suitable for
 * BullMQ and ioredis.
 */
export function parseRedisUrl(url: string): ParsedRedisConnection {
  try {
    const parsed = new URL(url)
    const dbStr = parsed.pathname ? parsed.pathname.slice(1) : ''
    const dbParsed = dbStr !== '' ? parseInt(dbStr, 10) : NaN
    const db = Number.isNaN(dbParsed) ? undefined : dbParsed
    const familyValue = parsed.searchParams.get('family')
    const familyParsed = familyValue !== null ? parseInt(familyValue, 10) : NaN
    const family = [0, 4, 6].includes(familyParsed) ? familyParsed : undefined
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port, 10) || 6379,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      db,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      family,
      protocol: REDIS_WIRE_PROTOCOL,
    }
  } catch {
    const safeUrl = url.replace(/\/\/[^:]*:[^@]*@/, '//<redacted>@')
    logger.warn('Failed to parse Redis URL, falling back to localhost:6379', { url: safeUrl })
    return { host: 'localhost', port: 6379, protocol: REDIS_WIRE_PROTOCOL }
  }
}

/**
 * Convenience: resolve the URL from env and parse it in one step.
 * Returns null when Redis is not configured.
 */
export function resolveRedisConnection(
  prefix?: string,
): (ParsedRedisConnection & { url: string }) | null {
  const url = getRedisUrl(prefix)
  if (!url) return null
  return { url, ...parseRedisUrl(url) }
}
