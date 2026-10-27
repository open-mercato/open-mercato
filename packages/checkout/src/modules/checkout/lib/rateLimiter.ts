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
}): Promise<NextResponse | null> {
  const { req, container, config, namespace, errorMessage, posture } = options
  const rateLimiter = resolveOptionalRateLimiter(container)
  if (!rateLimiter) {
    logger.error('Rate limiter service is not registered — check RATE_LIMIT_* configuration; checkout rate limiting is not enforced', {
      namespace,
      posture,
    })
    return null
  }

  try {
    const key = buildCheckoutRateLimitKey(req, rateLimiter, namespace)
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

export const checkoutPasswordRateLimitConfig = readEndpointRateLimitConfig('CHECKOUT_PASSWORD', {
  points: 5,
  duration: 60,
  blockDuration: 120,
  keyPrefix: 'checkout-password',
})
