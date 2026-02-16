interface RateLimitWindow {
  timestamps: number[]
}

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

const windows = new Map<string, RateLimitWindow>()

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now

  const cutoff = now - DAY_MS
  for (const [key, window] of windows) {
    window.timestamps = window.timestamps.filter((t) => t > cutoff)
    if (window.timestamps.length === 0) {
      windows.delete(key)
    }
  }
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): { allowed: boolean; retryAfterSeconds?: number } {
  cleanup()

  const now = Date.now()
  let window = windows.get(key)
  if (!window) {
    window = { timestamps: [] }
    windows.set(key, window)
  }

  const cutoffDay = now - DAY_MS
  window.timestamps = window.timestamps.filter((t) => t > cutoffDay)

  const countPerMinute = window.timestamps.filter((t) => t > now - MINUTE_MS).length
  if (countPerMinute >= config.maxPerMinute) {
    const oldestInWindow = window.timestamps.find((t) => t > now - MINUTE_MS)
    const retryAfter = oldestInWindow ? Math.ceil((oldestInWindow + MINUTE_MS - now) / 1000) : 60
    return { allowed: false, retryAfterSeconds: retryAfter }
  }

  const countPerHour = window.timestamps.filter((t) => t > now - HOUR_MS).length
  if (countPerHour >= config.maxPerHour) {
    const oldestInWindow = window.timestamps.find((t) => t > now - HOUR_MS)
    const retryAfter = oldestInWindow ? Math.ceil((oldestInWindow + HOUR_MS - now) / 1000) : 3600
    return { allowed: false, retryAfterSeconds: retryAfter }
  }

  if (window.timestamps.length >= config.maxPerDay) {
    const oldestInWindow = window.timestamps[0]
    const retryAfter = oldestInWindow ? Math.ceil((oldestInWindow + DAY_MS - now) / 1000) : 86400
    return { allowed: false, retryAfterSeconds: retryAfter }
  }

  window.timestamps.push(now)
  return { allowed: true }
}
