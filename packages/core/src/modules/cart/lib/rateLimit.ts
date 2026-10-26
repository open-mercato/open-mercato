import { NextResponse } from 'next/server'
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

// Step 4.7 — §15a's rate-limit table ("Via the shared `ratelimit` module ... env
// prefix `CART_*`, per cart token AND per IP"). Shaped after
// `ecommerce/lib/storefrontRateLimit.ts` (the task's named precedent) but with its
// own `CART_*`-prefixed env vars and its own three buckets, because §15a's budgets
// are this module's own release-frozen contract, not a reuse of ecommerce's
// storefront numbers.

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

let untrustedProxyWarned = false

function warnOnceWithoutTrustedProxy(trustProxyDepth: number): void {
  if (untrustedProxyWarned || (Number.isInteger(trustProxyDepth) && trustProxyDepth > 0)) return
  untrustedProxyWarned = true
  logger.warn(
    'Cart rate limits are inactive until RATE_LIMIT_TRUST_PROXY_DEPTH is set; the client IP cannot be trusted without it',
    { trustProxyDepth },
  )
}

export function readCartRateLimitConfig(endpoint: CartRateLimitEndpoint): RateLimitConfig {
  const defaults = CART_RATE_LIMITS[endpoint]
  return readEndpointRateLimitConfig(defaults.envPrefix, {
    points: defaults.points,
    duration: CART_RATE_LIMIT_WINDOW_SECONDS,
    keyPrefix: defaults.keyPrefix,
  })
}

function resolveRateLimiter(container: AppContainer): RateLimiterService | null {
  const hasRegistration = (container as { hasRegistration?: (name: string) => boolean }).hasRegistration
  if (typeof hasRegistration === 'function' && !hasRegistration.call(container, 'rateLimiterService')) return null
  try {
    return (container.resolve('rateLimiterService') as RateLimiterService | null) ?? null
  } catch (error) {
    logger.warn('Cart rate limiter unavailable; serving without a limit', { err: error })
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
 * §15a: `create` keys by IP alone (no token exists before a cart is created);
 * `mutate`/`read` key by `ip:token` ("per cart token AND per IP") — `token` is
 * `null` only when the caller never presented `X-Cart-Token`, in which case the
 * limit falls back to IP alone (the route itself still answers that request with a
 * 404, since there is no cart to resolve either way).
 *
 * Fail-open, matching `storefrontRateLimit.ts`: an unavailable limiter or an
 * unresolvable client IP (no trusted proxy depth configured) serves the request
 * instead of rejecting it; the missing proxy depth is logged once per process.
 */
export async function enforceCartRateLimit(
  container: AppContainer,
  req: Request,
  endpoint: CartRateLimitEndpoint,
  token: string | null,
): Promise<NextResponse | null> {
  const limiter = resolveRateLimiter(container)
  if (!limiter) return null
  try {
    warnOnceWithoutTrustedProxy(limiter.trustProxyDepth)
    const clientIp = getClientIp(req, limiter.trustProxyDepth)
    if (!clientIp) return null
    const key = token ? `${clientIp}:${token}` : clientIp
    const limited = await checkRateLimit(limiter, readCartRateLimitConfig(endpoint), key, await resolveRateLimitMessage())
    limited?.headers.set('Cache-Control', 'no-store')
    return limited
  } catch (error) {
    logger.warn('Cart rate limit check failed; serving without a limit', { err: error, endpoint })
    getTelemetryRuntime()?.reportError(error, { module: 'cart', code: 'cart.rate_limit_failed' })
    return null
  }
}
