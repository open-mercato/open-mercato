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
  /**
   * True when the limiter could not reach its backing store, so `allowed` is a
   * fallback rather than a real decision. Callers guarding state-mutating
   * endpoints SHOULD fail closed on this instead of letting the request through.
   * Absent (falsy) when rate limiting is switched off by configuration.
   */
  degraded?: boolean
}

export type RateLimitStrategy = 'memory' | 'redis'

export interface RateLimitGlobalConfig {
  enabled: boolean
  strategy: RateLimitStrategy
  keyPrefix: string
  redisUrl?: string
  /** Number of trusted reverse proxies for X-Forwarded-For IP extraction (default: 0) */
  trustProxyDepth: number
}
