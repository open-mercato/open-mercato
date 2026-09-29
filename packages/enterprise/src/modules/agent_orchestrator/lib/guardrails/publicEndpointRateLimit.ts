import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_FALLBACK_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'

/**
 * Resolves the shared limiter, distinguishing "no limiter in this deployment"
 * from "a limiter was configured and is now unusable".
 *
 * `absent` is a supported deployment shape (the DI registration is optional), so
 * callers fail OPEN on it. `broken` means the registration exists but resolving
 * it throws — a deployment that configured a ceiling and lost it must not
 * silently keep serving without one, so callers fail CLOSED.
 */
export function resolveRateLimiter(container: AwilixContainer): RateLimiterService | 'absent' | 'broken' {
  const hasRegistration =
    typeof container.hasRegistration === 'function' ? container.hasRegistration.bind(container) : null
  if (hasRegistration && !hasRegistration('rateLimiterService')) return 'absent'
  try {
    const limiter = container.resolve('rateLimiterService') as RateLimiterService | null
    return limiter ?? 'absent'
  } catch {
    return 'broken'
  }
}

/**
 * Per-client-IP ceiling for the module's unauthenticated / credential-verifying
 * endpoints (`/identity/token`, `/identity/agent/auth`, `/identity/well-known`,
 * `/trace/ingest`).
 *
 * Those endpoints are reachable without a session, and three of them spend real
 * CPU on the request (bcrypt compares per candidate client secret, JWT assertion
 * signature verification, HMAC verification plus a write), so an unmetered caller
 * gets both an unbounded credential-guessing oracle and a cheap amplification
 * lever. MUST be called BEFORE any credential verification work, otherwise the
 * amplification vector survives the limit.
 *
 * Returns a 429 (with `Retry-After` / `X-RateLimit-*`) when the ceiling is spent,
 * a 503 when the limiter is registered but unusable or its backing store could
 * not produce a decision (fail closed), and `null` when the request may proceed —
 * including when no limiter is registered at all (fail open).
 *
 * `keyDiscriminator` prefixes the client key for callers that must partition one
 * ceiling further (e.g. per provider); the per-endpoint `keyPrefix` in
 * `RateLimitConfig` already keeps separate endpoints on separate counters.
 */
export async function enforcePublicEndpointRateLimit(
  container: AwilixContainer,
  req: Request,
  config: RateLimitConfig,
  keyDiscriminator?: string,
): Promise<NextResponse | null> {
  const limiter = resolveRateLimiter(container)
  if (limiter === 'absent') return null
  if (limiter === 'broken') {
    return NextResponse.json({ error: RATE_LIMIT_UNAVAILABLE_FALLBACK }, { status: 503 })
  }

  const clientKey = getClientIp(req, limiter.trustProxyDepth) ?? RATE_LIMIT_FALLBACK_KEY
  const key = keyDiscriminator ? `${keyDiscriminator}:${clientKey}` : clientKey

  return checkRateLimit(limiter, config, key, RATE_LIMIT_ERROR_FALLBACK, {
    failClosed: true,
    unavailableMessage: RATE_LIMIT_UNAVAILABLE_FALLBACK,
  })
}
