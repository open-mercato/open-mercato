/**
 * Redis URL resolution and wire-protocol constant shared by the cache packages so
 * the stock Redis strategy does not depend on `@open-mercato/shared`, which
 * `@open-mercato/cache` does not (and cannot, without a cycle) declare.
 * `@open-mercato/shared/lib/redis/connection` re-exports these unchanged.
 */

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
