import { NextResponse } from 'next/server'
import type { RateLimitConfig } from './types'
import type { RateLimiterService } from './service'

export const RATE_LIMIT_ERROR_KEY = 'api.errors.rateLimit'
export const RATE_LIMIT_ERROR_FALLBACK = 'Too many requests. Please try again later.'

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

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
