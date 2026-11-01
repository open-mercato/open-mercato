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

// Step 4.5 (§6.2's own table — "Public, cart-token bound, rate limited per IP and per
// token"). Shaped after `cart/lib/rateLimit.ts` (this run's own established convention for a
// cart-token-bound, per-IP-and-per-token rate limit — reused a second time, by checkout's own
// `lib/rateLimiter.ts`, and now a third) with this module's own `ASSISTED_SELLING_*`-prefixed
// env vars and its own four buckets, exactly §6.2's own numbers.

type AssistedSellingBuyerRateLimitDefaults = { envPrefix: string; points: number; keyPrefix: string }

export const ASSISTED_SELLING_BUYER_RATE_LIMITS = {
  // §6.2: `GET /thread` — 120/min.
  read: { envPrefix: 'ASSISTED_SELLING_THREAD_READ', points: 120, keyPrefix: 'assisted_selling_thread_read' },
  // §6.2: `POST /thread` — 10/min.
  open: { envPrefix: 'ASSISTED_SELLING_THREAD_OPEN', points: 10, keyPrefix: 'assisted_selling_thread_open' },
  // §6.2: `POST /thread/messages` — 30/min.
  message: { envPrefix: 'ASSISTED_SELLING_THREAD_MESSAGE', points: 30, keyPrefix: 'assisted_selling_thread_message' },
  // §6.2: `GET /thread/events` — 240/min.
  events: { envPrefix: 'ASSISTED_SELLING_THREAD_EVENTS', points: 240, keyPrefix: 'assisted_selling_thread_events' },
} as const satisfies Record<string, AssistedSellingBuyerRateLimitDefaults>

export type AssistedSellingBuyerRateLimitEndpoint = keyof typeof ASSISTED_SELLING_BUYER_RATE_LIMITS

const ASSISTED_SELLING_RATE_LIMIT_WINDOW_SECONDS = 60

const logger = createLogger('assisted_selling').child({ component: 'rate-limit' })

let untrustedProxyWarned = false

function warnOnceWithoutTrustedProxy(trustProxyDepth: number): void {
  if (untrustedProxyWarned || (Number.isInteger(trustProxyDepth) && trustProxyDepth > 0)) return
  untrustedProxyWarned = true
  logger.warn(
    'Assisted-selling buyer rate limits are inactive until RATE_LIMIT_TRUST_PROXY_DEPTH is set; the client IP cannot be trusted without it',
    { trustProxyDepth },
  )
}

export function readAssistedSellingBuyerRateLimitConfig(endpoint: AssistedSellingBuyerRateLimitEndpoint): RateLimitConfig {
  const defaults = ASSISTED_SELLING_BUYER_RATE_LIMITS[endpoint]
  return readEndpointRateLimitConfig(defaults.envPrefix, {
    points: defaults.points,
    duration: ASSISTED_SELLING_RATE_LIMIT_WINDOW_SECONDS,
    keyPrefix: defaults.keyPrefix,
  })
}

function resolveRateLimiter(container: AppContainer): RateLimiterService | null {
  const hasRegistration = (container as { hasRegistration?: (name: string) => boolean }).hasRegistration
  if (typeof hasRegistration === 'function' && !hasRegistration.call(container, 'rateLimiterService')) return null
  try {
    return (container.resolve('rateLimiterService') as RateLimiterService | null) ?? null
  } catch (error) {
    logger.warn('Assisted-selling buyer rate limiter unavailable; serving without a limit', { err: error })
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
 * §6.2: "Public, cart-token bound, rate limited per IP and per token." Keys by `ip:token`;
 * `token` is `null` only when the caller never presented `X-Cart-Token`, in which case the
 * limit falls back to IP alone — the route itself still answers that request with the
 * unknown-thread `404` either way. Fail-open, mirroring `cart/lib/rateLimit.ts`: an
 * unavailable limiter or an unresolvable client IP serves the request instead of rejecting it.
 */
export async function enforceAssistedSellingBuyerRateLimit(
  container: AppContainer,
  req: Request,
  endpoint: AssistedSellingBuyerRateLimitEndpoint,
  token: string | null,
): Promise<NextResponse | null> {
  const limiter = resolveRateLimiter(container)
  if (!limiter) return null
  try {
    warnOnceWithoutTrustedProxy(limiter.trustProxyDepth)
    const clientIp = getClientIp(req, limiter.trustProxyDepth)
    if (!clientIp) return null
    const key = token ? `${clientIp}:${token}` : clientIp
    const limited = await checkRateLimit(limiter, readAssistedSellingBuyerRateLimitConfig(endpoint), key, await resolveRateLimitMessage())
    limited?.headers.set('Cache-Control', 'no-store')
    return limited
  } catch (error) {
    logger.warn('Assisted-selling buyer rate limit check failed; serving without a limit', { err: error, endpoint })
    getTelemetryRuntime()?.reportError(error, { module: 'assisted_selling', code: 'assisted_selling.rate_limit_failed' })
    return null
  }
}
