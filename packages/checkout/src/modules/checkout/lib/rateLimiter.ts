import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { getClientIp, RATE_LIMIT_FALLBACK_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'

export function buildCheckoutRateLimitKey(
  req: Request,
  rateLimiter: RateLimiterService,
  namespace: string,
): string {
  const clientKey = getClientIp(req, rateLimiter.trustProxyDepth) ?? RATE_LIMIT_FALLBACK_KEY
  return `${namespace}:${clientKey}`
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
