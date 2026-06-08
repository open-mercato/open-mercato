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

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number }

// Process-local fallback used when the shared cache is unavailable or errors.
// Keeping a bounded map here means the limiter fails CLOSED instead of open:
// throttling still applies (per process) even if Redis/SQLite is down. The map
// is pruned opportunistically so it cannot grow without bound.
const fallbackBuckets = new Map<string, number[]>()
const FALLBACK_MAX_KEYS = 10000

function pruneFallbackBuckets(now: number): void {
  if (fallbackBuckets.size <= FALLBACK_MAX_KEYS) return
  for (const [key, timestamps] of fallbackBuckets) {
    const recent = timestamps.filter((timestamp) => timestamp > now - DAY_MS)
    if (recent.length === 0) {
      fallbackBuckets.delete(key)
    } else {
      fallbackBuckets.set(key, recent)
    }
    if (fallbackBuckets.size <= FALLBACK_MAX_KEYS) break
  }
}

function evaluate(
  timestamps: number[],
  now: number,
  config: RateLimitConfig,
): { result: RateLimitResult; nextTimestamps: number[] } {
  const cutoffDay = now - DAY_MS
  const recentTimestamps = timestamps.filter((timestamp) => timestamp > cutoffDay)

  const countPerMinute = recentTimestamps.filter((timestamp) => timestamp > now - MINUTE_MS).length
  if (countPerMinute >= config.maxPerMinute) {
    const oldestInWindow = recentTimestamps.find((timestamp) => timestamp > now - MINUTE_MS)
    const retryAfter = oldestInWindow ? Math.ceil((oldestInWindow + MINUTE_MS - now) / 1000) : 60
    return { result: { allowed: false, retryAfterSeconds: retryAfter }, nextTimestamps: recentTimestamps }
  }

  const countPerHour = recentTimestamps.filter((timestamp) => timestamp > now - HOUR_MS).length
  if (countPerHour >= config.maxPerHour) {
    const oldestInWindow = recentTimestamps.find((timestamp) => timestamp > now - HOUR_MS)
    const retryAfter = oldestInWindow ? Math.ceil((oldestInWindow + HOUR_MS - now) / 1000) : 3600
    return { result: { allowed: false, retryAfterSeconds: retryAfter }, nextTimestamps: recentTimestamps }
  }

  if (recentTimestamps.length >= config.maxPerDay) {
    const oldestInWindow = recentTimestamps[0]
    const retryAfter = oldestInWindow ? Math.ceil((oldestInWindow + DAY_MS - now) / 1000) : 86400
    return { result: { allowed: false, retryAfterSeconds: retryAfter }, nextTimestamps: recentTimestamps }
  }

  recentTimestamps.push(now)
  return { result: { allowed: true }, nextTimestamps: recentTimestamps }
}

function checkFallback(key: string, now: number, config: RateLimitConfig): RateLimitResult {
  const cacheKey = `inbox_ops:rate_limit:${key}`
  const existing = fallbackBuckets.get(cacheKey) ?? []
  const { result, nextTimestamps } = evaluate(existing, now, config)
  fallbackBuckets.set(cacheKey, nextTimestamps)
  pruneFallbackBuckets(now)
  return result
}

export async function checkRateLimit(
  cache: CacheStrategy | null,
  key: string,
  tenantId?: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const now = Date.now()

  // Fail CLOSED: when the shared cache is unavailable, fall back to a bounded
  // process-local limiter instead of waving every request through.
  if (!cache) {
    return checkFallback(key, now, config)
  }

  const cacheKey = `inbox_ops:rate_limit:${key}`

  try {
    const raw = await cache.get(cacheKey)
    const timestamps: number[] = Array.isArray(raw) ? (raw as number[]) : []

    const { result, nextTimestamps } = evaluate(timestamps, now, config)
    if (!result.allowed) {
      return result
    }

    const tags = tenantId ? [`inbox_ops:rate_limit:${tenantId}`] : []
    await cache.set(cacheKey, nextTimestamps, { ttl: DAY_MS, tags })

    return result
  } catch {
    // Cache error: do not fail open — apply the process-local limiter so a
    // degraded cache cannot be used to bypass throttling.
    return checkFallback(key, now, config)
  }
}

// Exposed for tests to reset process-local state between cases.
export function __resetRateLimiterFallback(): void {
  fallbackBuckets.clear()
}
