import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readEndpointRateLimitConfig, readRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_FALLBACK_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

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

export async function enforceCheckoutRateLimit(options: {
  req: Request
  container: RateLimiterContainer
  config: RateLimitConfig
  namespace: string
  errorMessage: string
  posture: CheckoutRateLimitPosture
  checkoutSlug?: string
}): Promise<NextResponse | null> {
  const { req, container, config, namespace, errorMessage, posture, checkoutSlug } = options
  try {
    const rateLimiter = resolveOptionalRateLimiter(container)
    if (!rateLimiter) {
      if (checkoutSlug !== undefined && readRateLimitConfig().enabled) {
        throw new Error('[internal] Checkout password rate limiter is not registered')
      }
      logger.error('Checkout rate limiter is not registered', { namespace, posture })
      return null
    }
    const checkOptions = { failClosed: posture === 'fail-closed' }
    if (checkoutSlug !== undefined) {
      const clientIp = getClientIp(req, rateLimiter.trustProxyDepth)
      if (clientIp) {
        const ipLimit = await checkRateLimit(rateLimiter, config, `${namespace}:ip:${clientIp}`, errorMessage, checkOptions)
        if (ipLimit) return ipLimit
      }
      const slugHash = createHash('sha256').update(checkoutSlug).digest('hex')
      return await checkRateLimit(rateLimiter, config, `${namespace}:link:${slugHash}`, errorMessage, checkOptions)
    }
    const key = buildCheckoutRateLimitKey(req, rateLimiter, namespace)
    return await checkRateLimit(rateLimiter, config, key, errorMessage, checkOptions)
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'checkout', code: 'checkout.rate_limit_failed' })
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
