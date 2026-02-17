import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { RateLimitConfig } from './types'
import type { RateLimiterService } from './service'

export const RATE_LIMIT_ERROR_KEY = 'api.errors.rateLimit'
export const RATE_LIMIT_ERROR_FALLBACK = 'Too many requests. Please try again later.'

export const rateLimitErrorSchema = z.object({
  error: z.string().describe('Rate limit exceeded message'),
})

/**
 * Check rate limit for a request. Returns a 429 NextResponse if rate limited, or null if allowed.
 * Rate limit headers (X-RateLimit-*, Retry-After) are only included on 429 responses.
 */
export async function checkRateLimit(
  rateLimiterService: RateLimiterService,
  config: RateLimitConfig,
  key: string,
  errorMessage: string,
): Promise<NextResponse | null> {
  const result = await rateLimiterService.consume(key, config)

  if (!result.allowed) {
    const retryAfterSec = Math.ceil(result.msBeforeNext / 1000)
    return NextResponse.json(
      { error: errorMessage },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(config.points),
          'X-RateLimit-Remaining': String(result.remainingPoints),
          'X-RateLimit-Reset': String(retryAfterSec),
        },
      },
    )
  }

  return null
}

/**
 * Extract client IP from a request, respecting reverse proxy trust depth.
 *
 * @param trustProxyDepth Number of trusted reverse proxies between the client and the app.
 *   - 0 (default): Do not trust X-Forwarded-For; fall back to X-Real-IP or null.
 *   - 1: One trusted proxy (e.g. nginx) — the last entry in X-Forwarded-For is the client IP.
 *   - N: N trusted proxies — the Nth-from-last entry is the client IP.
 *
 * With depth=0, X-Forwarded-For is ignored entirely to prevent spoofing.
 */
export function getClientIp(req: Request, trustProxyDepth: number = 0): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded && trustProxyDepth > 0) {
    const ips = forwarded.split(',').map((ip) => ip.trim())
    const clientIndex = ips.length - trustProxyDepth
    return clientIndex >= 0 ? ips[clientIndex] : ips[0]
  }
  return req.headers.get('x-real-ip') ?? null
}
