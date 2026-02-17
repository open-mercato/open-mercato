export interface RateLimitConfig {
  /** Max points (requests) allowed in the window */
  points: number
  /** Window duration in seconds */
  duration: number
  /** Block duration in seconds after limit is exceeded (0 = no block, just reject) */
  blockDuration?: number
  /** Key prefix for this specific limiter (appended to global prefix) */
  keyPrefix?: string
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining points in the current window */
  remainingPoints: number
  /** Milliseconds until the current window resets */
  msBeforeNext: number
  /** Total points consumed in the current window */
  consumedPoints: number
}

export type RateLimitStrategy = 'memory' | 'redis'

export interface RateLimitGlobalConfig {
  enabled: boolean
  strategy: RateLimitStrategy
  keyPrefix: string
  redisUrl?: string
  /** Number of trusted reverse proxies for X-Forwarded-For IP extraction (default: 1) */
  trustProxyDepth: number
}
