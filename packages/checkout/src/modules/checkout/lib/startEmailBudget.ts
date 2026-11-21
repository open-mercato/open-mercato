import { createHash } from 'node:crypto'
import { readEndpointRateLimitConfig, readRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'

const recipientBudget = readEndpointRateLimitConfig('CHECKOUT_START_EMAIL_RECIPIENT', {
  points: 3,
  duration: 3600,
  keyPrefix: 'checkout-start-email-recipient',
})

const linkBudget = readEndpointRateLimitConfig('CHECKOUT_START_EMAIL_LINK', {
  points: 100,
  duration: 3600,
  keyPrefix: 'checkout-start-email-link',
})

export async function consumeStartEmailBudget(
  container: { resolve: <T = unknown>(name: string) => T },
  scope: { email: string; linkId: string; tenantId: string; organizationId: string },
): Promise<boolean> {
  const rateLimiter = container.resolve<RateLimiterService>('rateLimiterService')
  const recipientHash = createHash('sha256').update(scope.email.trim().toLowerCase()).digest('hex')
  const scopeKey = `${scope.tenantId}:${scope.organizationId}`
  const globalConfig = readRateLimitConfig()
  const requireShared = globalConfig.enabled && globalConfig.strategy === 'redis'
  for (const [key, config] of [
    [`${scopeKey}:${recipientHash}`, recipientBudget],
    [`${scopeKey}:${scope.linkId}`, linkBudget],
  ] as const) {
    const result = await rateLimiter.consume(key, { ...config, requireShared })
    if (result.degraded) throw new Error('[internal] Checkout start email budget is unavailable')
    if (!result.allowed) return false
  }
  return true
}
