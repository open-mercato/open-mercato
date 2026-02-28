import type { CacheStrategy } from '@open-mercato/cache'

interface RateLimitConfig {
  maxPerMinute: number
  maxPerHour: number
  maxPerDay: number
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxPerMinute: 10,
  maxPerHour: 100,
  maxPerDay: 1000,
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export async function checkRateLimit(
  cache: CacheStrategy | null,
  key: string,
  tenantId?: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  if (!cache) return { allowed: true }

  const now = Date.now()
  const cacheKey = `inbox_ops:rate_limit:${key}`

  try {
    const raw = await cache.get(cacheKey)
    const timestamps: number[] = Array.isArray(raw) ? (raw as number[]) : []

    const cutoffDay = now - DAY_MS
    const recentTimestamps = timestamps.filter((t) => t > cutoffDay)

    const countPerMinute = recentTimestamps.filter((t) => t > now - MINUTE_MS).length
    if (countPerMinute >= config.maxPerMinute) {
      const oldestInWindow = recentTimestamps.find((t) => t > now - MINUTE_MS)
      const retryAfter = oldestInWindow ? Math.ceil((oldestInWindow + MINUTE_MS - now) / 1000) : 60
      return { allowed: false, retryAfterSeconds: retryAfter }
    }

    const countPerHour = recentTimestamps.filter((t) => t > now - HOUR_MS).length
    if (countPerHour >= config.maxPerHour) {
      const oldestInWindow = recentTimestamps.find((t) => t > now - HOUR_MS)
      const retryAfter = oldestInWindow ? Math.ceil((oldestInWindow + HOUR_MS - now) / 1000) : 3600
      return { allowed: false, retryAfterSeconds: retryAfter }
    }

    if (recentTimestamps.length >= config.maxPerDay) {
      const oldestInWindow = recentTimestamps[0]
      const retryAfter = oldestInWindow ? Math.ceil((oldestInWindow + DAY_MS - now) / 1000) : 86400
      return { allowed: false, retryAfterSeconds: retryAfter }
    }

    recentTimestamps.push(now)
    const tags = tenantId ? [`inbox_ops:rate_limit:${tenantId}`] : []
    await cache.set(cacheKey, recentTimestamps, { ttl: DAY_MS, tags })

    return { allowed: true }
  } catch {
    return { allowed: true }
  }
}
