import type { NextResponse } from 'next/server'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_ERROR_KEY,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { StoreContext } from './types'

type StorefrontRateLimitDefaults = {
  envPrefix: string
  points: number
  keyPrefix: string
}

export const STOREFRONT_RATE_LIMITS = {
  context: { envPrefix: 'ECOMMERCE_STOREFRONT_CONTEXT', points: 120, keyPrefix: 'ecommerce_storefront_context' },
  products: { envPrefix: 'ECOMMERCE_STOREFRONT_PRODUCTS', points: 120, keyPrefix: 'ecommerce_storefront_products' },
  productDetail: {
    envPrefix: 'ECOMMERCE_STOREFRONT_PRODUCT_DETAIL',
    points: 240,
    keyPrefix: 'ecommerce_storefront_product_detail',
  },
  categories: { envPrefix: 'ECOMMERCE_STOREFRONT_CATEGORIES', points: 120, keyPrefix: 'ecommerce_storefront_categories' },
  categoryLanding: {
    envPrefix: 'ECOMMERCE_STOREFRONT_CATEGORY_LANDING',
    points: 120,
    keyPrefix: 'ecommerce_storefront_category_landing',
  },
  searchSuggest: {
    envPrefix: 'ECOMMERCE_STOREFRONT_SEARCH_SUGGEST',
    points: 300,
    keyPrefix: 'ecommerce_storefront_search_suggest',
  },
} as const satisfies Record<string, StorefrontRateLimitDefaults>

export type StorefrontRateLimitEndpoint = keyof typeof STOREFRONT_RATE_LIMITS

const STOREFRONT_RATE_LIMIT_WINDOW_SECONDS = 60
const STOREFRONT_RATE_LIMITED_CACHE_CONTROL = 'no-store'

const logger = createLogger('ecommerce').child({ component: 'storefront-rate-limit' })

let untrustedProxyWarned = false

function warnOnceWithoutTrustedProxy(trustProxyDepth: number): void {
  if (untrustedProxyWarned || (Number.isInteger(trustProxyDepth) && trustProxyDepth > 0)) return
  untrustedProxyWarned = true
  logger.warn(
    'Storefront rate limits are inactive until RATE_LIMIT_TRUST_PROXY_DEPTH is set; the client IP cannot be trusted without it',
    { trustProxyDepth },
  )
}

export function readStorefrontRateLimitConfig(endpoint: StorefrontRateLimitEndpoint): RateLimitConfig {
  const defaults = STOREFRONT_RATE_LIMITS[endpoint]
  return readEndpointRateLimitConfig(defaults.envPrefix, {
    points: defaults.points,
    duration: STOREFRONT_RATE_LIMIT_WINDOW_SECONDS,
    keyPrefix: defaults.keyPrefix,
  })
}

export function buildStorefrontRateLimitKey(clientIp: string, storeId: string): string {
  return `${clientIp}:${storeId}`
}

function resolveRateLimiter(container: AppContainer): RateLimiterService | null {
  const hasRegistration = (container as { hasRegistration?: (name: string) => boolean }).hasRegistration
  if (typeof hasRegistration === 'function' && !hasRegistration.call(container, 'rateLimiterService')) return null
  try {
    return (container.resolve('rateLimiterService') as RateLimiterService | null) ?? null
  } catch (error) {
    logger.warn('Storefront rate limiter unavailable; serving without a limit', { err: error })
    return null
  }
}

async function resolveRateLimitMessage(): Promise<string> {
  try {
    const { translate } = await resolveTranslations()
    return translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)
  } catch {
    return RATE_LIMIT_ERROR_FALLBACK
  }
}

/**
 * Per-IP-per-store limit for the public storefront routes (spec 4 §9). Called after the store is
 * resolved, because the key is `ip:storeId`. Fail-open: an unavailable limiter or an unresolvable
 * client IP (no trusted proxy depth configured) serves the request instead of rejecting it; the
 * missing proxy depth is logged once per process so the inactive limit is visible to operators.
 */
export async function enforceStorefrontRateLimit(
  container: AppContainer,
  req: Request,
  context: StoreContext,
  endpoint: StorefrontRateLimitEndpoint,
): Promise<NextResponse | null> {
  const limiter = resolveRateLimiter(container)
  if (!limiter) return null
  try {
    warnOnceWithoutTrustedProxy(limiter.trustProxyDepth)
    const clientIp = getClientIp(req, limiter.trustProxyDepth)
    if (!clientIp) return null
    const limited = await checkRateLimit(
      limiter,
      readStorefrontRateLimitConfig(endpoint),
      buildStorefrontRateLimitKey(clientIp, context.store.id),
      await resolveRateLimitMessage(),
    )
    limited?.headers.set('Cache-Control', STOREFRONT_RATE_LIMITED_CACHE_CONTROL)
    return limited
  } catch (error) {
    logger.warn('Storefront rate limit check failed; serving without a limit', { err: error, endpoint })
    getTelemetryRuntime()?.reportError(error, { module: 'ecommerce', code: 'ecommerce.storefront_rate_limit_failed' })
    return null
  }
}
