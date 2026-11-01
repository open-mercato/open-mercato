import { NextResponse } from 'next/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_FALLBACK_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'

const logger = createLogger('checkout')

export function buildCheckoutRateLimitKey(
  req: Request,
  rateLimiter: RateLimiterService,
  namespace: string,
): string {
  const clientKey = getClientIp(req, rateLimiter.trustProxyDepth) ?? RATE_LIMIT_FALLBACK_KEY
  return `${namespace}:${clientKey}`
}

/**
 * `fail-closed` rejects with 503 when the limiter cannot decide, for endpoints where an
 * unenforced limit is worse than a rejected request. `fail-open` lets the request through
 * and only logs, for read-only endpoints.
 */
export type CheckoutRateLimitPosture = 'fail-open' | 'fail-closed'

type RateLimiterContainer = {
  resolve: (name: string) => unknown
  hasRegistration?: (name: string) => boolean
}

/**
 * `rateLimiterService` is registered conditionally — `getCachedRateLimiterService()` returns
 * null when the rate-limit configuration itself is invalid, and then the DI key never exists.
 * That is a deployment-time misconfiguration rather than a transient outage, so it is kept
 * distinct from a limiter that is registered but cannot decide.
 */
function resolveOptionalRateLimiter(container: RateLimiterContainer): RateLimiterService | null {
  if (typeof container.hasRegistration === 'function' && !container.hasRegistration('rateLimiterService')) {
    return null
  }
  try {
    return (container.resolve('rateLimiterService') as RateLimiterService | undefined) ?? null
  } catch {
    return null
  }
}

/**
 * Run the checkout rate-limit guard for one request and return the response that should be
 * sent instead of handling it, or null to continue.
 *
 * Three outcomes are deliberately distinguished:
 * - the limiter is not configured at all → logged as a configuration error and the check is
 *   skipped, matching `sales/quotes/accept`; the endpoint is never reported as temporarily
 *   unavailable for a condition that lasts until an operator fixes the environment
 * - the limiter is configured but could not decide (degraded, or the check threw) → 503 under
 *   `fail-closed`, a logged warning under `fail-open`
 * - the limiter decided the quota is exhausted → the 429 from `checkRateLimit`
 */
export async function enforceCheckoutRateLimit(options: {
  req: Request
  container: RateLimiterContainer
  config: RateLimitConfig
  namespace: string
  errorMessage: string
  posture: CheckoutRateLimitPosture
  /**
   * Overrides the default IP-derived key (`buildCheckoutRateLimitKey`). Session-scoped
   * checkout routes (§13: "60/min per session" on `/sessions/current/*` mutations) key by
   * the session's own token hash instead of the caller's IP — additive, every existing
   * caller omits it and keeps the IP-keyed behavior unchanged.
   */
  keyOverride?: string
}): Promise<NextResponse | null> {
  const { req, container, config, namespace, errorMessage, posture, keyOverride } = options
  const rateLimiter = resolveOptionalRateLimiter(container)
  if (!rateLimiter) {
    logger.error('Rate limiter service is not registered — check RATE_LIMIT_* configuration; checkout rate limiting is not enforced', {
      namespace,
      posture,
    })
    return null
  }

  try {
    const key = keyOverride ?? buildCheckoutRateLimitKey(req, rateLimiter, namespace)
    return await checkRateLimit(rateLimiter, config, key, errorMessage, {
      failClosed: posture === 'fail-closed',
    })
  } catch (error) {
    if (posture === 'fail-closed') {
      logger.error('Checkout rate limit check failed, rejecting request', { err: error, namespace })
      return NextResponse.json({ error: RATE_LIMIT_UNAVAILABLE_FALLBACK }, { status: 503 })
    }
    logger.warn('Checkout rate limit check failed, allowing request', { err: error, namespace })
    return null
  }
}

export const checkoutPublicViewRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_PUBLIC_VIEW', {
  points: 60,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'checkout-public-view',
})

export const checkoutStatusRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_STATUS', {
  points: 120,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'checkout-status',
})

export const checkoutSubmitRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_SUBMIT', {
  points: 10,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'checkout-submit',
})

// Release 5, Step 4.2 (B.4, §13: "`POST /sessions/current/submit` | 10/min per session,
// 60/min per IP | fail-closed"). The session-scoped 10/min bucket reuses
// `checkoutSubmitRateLimitConfig` above (same point budget, scoped by `keyOverride` to the
// session's own token hash, same pattern `checkoutSessionMutateSessionRateLimitConfig`
// already set) — this is the SEPARATE per-IP bucket enforced alongside it. Distinct
// keyPrefix from Phase A's own `checkout-submit` (its pay-link `/pay/[slug]/submit` route,
// 10/min per IP with NO session concept) so the two buckets never share a counter.
export const checkoutSessionSubmitIpRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_SESSION_SUBMIT_IP', {
  points: 60,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'checkout-session-submit-ip',
})

export const checkoutPasswordRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_PASSWORD', {
  points: 5,
  duration: 60,
  blockDuration: 120,
  keyPrefix: 'checkout-password',
})

// Release 5, Step 2.12 (B.1, §13 — C14's rate-limit minimum). Exact numbers per the
// revised spec's own table; see `NOTIFY.md` for the create route's own (unnamed by C14)
// choice.
export const checkoutSessionCreateRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_SESSION_CREATE', {
  points: 20,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'checkout-session-create',
})

/** §13: "60/min per session" on every `PATCH`/`POST` under `/sessions/current`. */
export const checkoutSessionMutateSessionRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_SESSION_MUTATE_SESSION', {
  points: 60,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'checkout-session-mutate-session',
})

/** §13: "120/min per IP" on the SAME routes — enforced alongside, not instead of, the
 * per-session bucket above. */
export const checkoutSessionMutateIpRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_SESSION_MUTATE_IP', {
  points: 120,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'checkout-session-mutate-ip',
})

// Release 5, Step 2.13 (B.3, §13): "`GET /sessions/current/delivery-options` (B.3) |
// 30/min per session". Fail-closed, per §13's own table.
export const checkoutDeliveryOptionsRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_DELIVERY_OPTIONS', {
  points: 30,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'checkout-delivery-options',
})

// §13: "Other `GET` under `/sessions/current` | 120/min per session | fail-open" —
// `GET .../payment-methods` (B.3) falls under this row.
export const checkoutSessionOtherGetRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_SESSION_OTHER_GET', {
  points: 120,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'checkout-session-other-get',
})

/** Builds the session-scoped rate-limit key for `/sessions/current/*` mutations —
 * `enforceCheckoutRateLimit`'s `keyOverride`, keyed by the session's own token hash
 * (never the plaintext token) so the bucket survives across requests from different IPs
 * for the same session. */
export function buildCheckoutSessionScopedRateLimitKey(namespace: string, sessionTokenHash: string): string {
  return `${namespace}:session:${sessionTokenHash}`
}
