/**
 * Fail-open rate limiting for the public (anonymous) forms runtime endpoints.
 *
 * The shared `RateLimiterService` is resolved lazily through the core
 * bootstrap cache. If it is not available (not configured / disabled), every
 * request is allowed — abuse controls then fall back to the distribution-level
 * caps, availability window, and token entropy (R-2d-1). A limiter that throws
 * mid-flight must NEVER 500 a public request, so all failures resolve to
 * "allowed".
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'

const PUBLIC_POINTS = Number.parseInt(process.env.FORMS_PUBLIC_RATE_LIMIT_PER_MIN ?? '', 10)

const publicRateLimitConfig = readEndpointRateLimitConfig('FORMS_PUBLIC', {
  points: Number.isFinite(PUBLIC_POINTS) && PUBLIC_POINTS > 0 ? PUBLIC_POINTS : 30,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'forms-public',
})

export function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

/**
 * Consumes one point for `key`. Returns a 429 NextResponse when the limit is
 * exceeded, otherwise `null`. Fails open on any limiter error.
 */
export async function enforcePublicRateLimit(key: string): Promise<NextResponse | null> {
  try {
    const limiter = getCachedRateLimiterService()
    if (!limiter) return null
    const result = await limiter.consume(key, publicRateLimitConfig)
    if (result.allowed) return null
    const retryAfter = Math.ceil((result.msBeforeNext ?? 0) / 1000)
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Too many requests.', details: { retryAfterSeconds: retryAfter } },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  } catch {
    return null
  }
}
