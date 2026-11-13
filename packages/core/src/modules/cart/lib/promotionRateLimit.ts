import { NextResponse } from 'next/server'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_ERROR_KEY,
  RATE_LIMIT_FALLBACK_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
  RATE_LIMIT_UNAVAILABLE_KEY,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ResolvedCartRouteContext } from './routeContext'

const WINDOW_SECONDS = 60
const CLIENT_LIMIT: RateLimitConfig = { points: 20, duration: WINDOW_SECONDS, keyPrefix: 'cart_promotion_client' }
const STORE_LIMIT: RateLimitConfig = { points: 100, duration: WINDOW_SECONDS, keyPrefix: 'cart_promotion_store_failures' }
const logger = createLogger('cart').child({ component: 'promotion-rate-limit' })

type PromotionAttempt =
  | { ok: false; response: NextResponse }
  | { ok: true; succeeded: () => Promise<void> }

export async function reserveCartPromotionAttempt(
  container: AppContainer,
  request: Request,
  scope: Pick<ResolvedCartRouteContext, 'tenantId' | 'organizationId' | 'storeId'>,
): Promise<PromotionAttempt> {
  const translations = await resolveTranslations().catch(() => null)
  const limitedMessage = translations?.translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK) ?? RATE_LIMIT_ERROR_FALLBACK
  const unavailableMessage = translations?.translate(RATE_LIMIT_UNAVAILABLE_KEY, RATE_LIMIT_UNAVAILABLE_FALLBACK) ?? RATE_LIMIT_UNAVAILABLE_FALLBACK

  try {
    const limiter = container.resolve<RateLimiterService>('rateLimiterService')
    if (!limiter) throw new Error('[internal] promotion rate limiter unavailable')
    const scopeKey = `${scope.tenantId}:${scope.organizationId}:${scope.storeId}`
    const clientKey = getClientIp(request, limiter.trustProxyDepth) ?? RATE_LIMIT_FALLBACK_KEY
    const options = { failClosed: true, unavailableMessage }
    const clientLimited = await checkRateLimit(limiter, CLIENT_LIMIT, `${scopeKey}:${clientKey}`, limitedMessage, options)
    if (clientLimited) {
      clientLimited.headers.set('Cache-Control', 'no-store')
      return { ok: false, response: clientLimited }
    }

    const windowId = Math.floor(Date.now() / (WINDOW_SECONDS * 1000))
    const storeKey = `${scopeKey}:${windowId}`
    const storeLimited = await checkRateLimit(limiter, STORE_LIMIT, storeKey, limitedMessage, options)
    if (storeLimited) {
      storeLimited.headers.set('Cache-Control', 'no-store')
      if (storeLimited.status === 429) logger.warn('Store promotion attempt budget exhausted', scope)
      return { ok: false, response: storeLimited }
    }

    return {
      ok: true,
      succeeded: async () => {
        if (Math.floor(Date.now() / (WINDOW_SECONDS * 1000)) !== windowId) return
        try {
          await limiter.reward(storeKey, 1, STORE_LIMIT)
        } catch (error) {
          logger.warn('Promotion attempt refund failed; retaining consumed budget', { err: error })
          getTelemetryRuntime()?.reportError(error, { module: 'cart', code: 'cart.promotion_budget_refund_failed' })
        }
      },
    }
  } catch (error) {
    logger.warn('Promotion rate limiter unavailable; rejecting attempt', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'cart', code: 'cart.promotion_rate_limit_failed' })
    return {
      ok: false,
      response: NextResponse.json({ error: unavailableMessage }, { status: 503, headers: { 'Cache-Control': 'no-store' } }),
    }
  }
}
