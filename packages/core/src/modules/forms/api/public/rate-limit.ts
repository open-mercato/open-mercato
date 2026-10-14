import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  getClientIp,
  RATE_LIMIT_ERROR_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'

const PUBLIC_POINTS = Number.parseInt(process.env.FORMS_PUBLIC_RATE_LIMIT_PER_MIN ?? '', 10)

const publicRateLimitConfig = readEndpointRateLimitConfig('FORMS_PUBLIC', {
  points: Number.isFinite(PUBLIC_POINTS) && PUBLIC_POINTS > 0 ? PUBLIC_POINTS : 30,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'forms-public',
})

function unavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: 'RATE_LIMIT_UNAVAILABLE' },
    { status: 503 },
  )
}

export function buildPublicRateLimitKey(namespace: string, ...identifiers: string[]): string {
  const digest = createHash('sha256')
    .update(identifiers.join('\0'))
    .digest('base64url')
    .slice(0, 32)
  return `${namespace}:${digest}`
}

export function getPublicClientIp(req: Request): string | undefined {
  const limiter = getCachedRateLimiterService()
  if (!limiter) return undefined
  return getClientIp(req, limiter.trustProxyDepth) ?? undefined
}

/**
 * Applies the shared process/Redis-backed limiter to a public Forms resource.
 * Proxy headers are trusted only at the globally configured proxy depth. When
 * no trusted client address is available, the caller-supplied resource digest
 * remains the bucket key instead of collapsing all respondents into one global
 * bucket. An absent, degraded, or throwing limiter fails closed.
 */
export async function enforcePublicRateLimit(
  req: Request,
  resourceKey: string,
): Promise<NextResponse | null> {
  const limiter = getCachedRateLimiterService()
  if (!limiter) return unavailableResponse()

  const clientIp = getClientIp(req, limiter.trustProxyDepth)
  const key = clientIp ? `${resourceKey}:client:${clientIp}` : `${resourceKey}:resource`

  try {
    const result = await limiter.consume(key, publicRateLimitConfig)
    if ('degraded' in result && result.degraded === true) return unavailableResponse()
    if (result.allowed) return null
    const retryAfter = Math.ceil((result.msBeforeNext ?? 0) / 1000)
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: RATE_LIMIT_ERROR_FALLBACK, details: { retryAfterSeconds: retryAfter } },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  } catch {
    return unavailableResponse()
  }
}
