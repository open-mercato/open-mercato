import { NextResponse } from 'next/server'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readEndpointRateLimitConfig, readRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_ERROR_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { hashCartToken } from './token'

type CartRateLimitDefaults = { envPrefix: string; points: number; keyPrefix: string }

export const CART_RATE_LIMITS = {
  // §15a: 20 / min / IP — no cart token exists yet at creation time.
  create: { envPrefix: 'CART_CREATE', points: 20, keyPrefix: 'cart_create' },
  // §15a: 60 / min / token — lines, promotions, merge, reprice. This step only
  // wires the line-mutation routes; promotions/merge/reprice land in later steps
  // and reuse the same bucket when their routes are built.
  mutate: { envPrefix: 'CART_MUTATE', points: 60, keyPrefix: 'cart_mutate' },
  // §15a: 120 / min / token.
  read: { envPrefix: 'CART_READ', points: 120, keyPrefix: 'cart_read' },
} as const satisfies Record<string, CartRateLimitDefaults>

export type CartRateLimitEndpoint = keyof typeof CART_RATE_LIMITS

const CART_RATE_LIMIT_WINDOW_SECONDS = 60

const logger = createLogger('cart').child({ component: 'rate-limit' })

export function readCartRateLimitConfig(endpoint: CartRateLimitEndpoint): RateLimitConfig {
  const defaults = CART_RATE_LIMITS[endpoint]
  return readEndpointRateLimitConfig(defaults.envPrefix, {
    points: defaults.points,
    duration: CART_RATE_LIMIT_WINDOW_SECONDS,
    keyPrefix: defaults.keyPrefix,
  })
}

function resolveRateLimiter(container: AppContainer): RateLimiterService | null {
  if (typeof container.hasRegistration === 'function' && !container.hasRegistration('rateLimiterService')) return null
  return container.resolve<RateLimiterService | null>('rateLimiterService')
}

function unavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: RATE_LIMIT_UNAVAILABLE_FALLBACK },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function resolveRateLimitMessage(): Promise<string> {
  try {
    const { translate } = await resolveTranslations()
    return translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)
  } catch {
    return RATE_LIMIT_ERROR_FALLBACK
  }
}

export async function enforceCartRateLimit(
  container: AppContainer,
  req: Request,
  endpoint: CartRateLimitEndpoint,
  token: string | null,
  storeId?: string,
): Promise<NextResponse | null> {
  try {
    const limiter = resolveRateLimiter(container)
    if (!limiter) {
      if (!readRateLimitConfig().enabled) return null
      throw new Error('[internal] Cart rate limiter is not registered')
    }

    const config = readCartRateLimitConfig(endpoint)
    const clientIp = getClientIp(req, limiter.trustProxyDepth)
    const sourceKey = clientIp ? `ip:${clientIp}` : `unattributed:${storeId ?? 'default'}`
    const sourceConfig = clientIp ? config : { ...config, points: config.points * 10 }
    const message = await resolveRateLimitMessage()
    const options = { failClosed: true }
    let limited = await checkRateLimit(limiter, sourceConfig, sourceKey, message, options)
    if (!limited && token && endpoint !== 'create') {
      limited = await checkRateLimit(limiter, config, `cart:${hashCartToken(token)}`, message, options)
    }
    limited?.headers.set('Cache-Control', 'no-store')
    return limited
  } catch (error) {
    logger.error('Cart rate limit check failed', { err: error, endpoint })
    getTelemetryRuntime()?.reportError(error, { module: 'cart', code: 'cart.rate_limit_failed' })
    return unavailableResponse()
  }
}
