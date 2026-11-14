import { createHash } from 'node:crypto'
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
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
  RATE_LIMIT_UNAVAILABLE_KEY,
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

let unusableClientIpFlagged = false

function flagUnusableClientIp(trustProxyDepth: number): void {
  if (unusableClientIpFlagged) return
  unusableClientIpFlagged = true
  const message =
    'Assisted-selling buyer rate limits cannot key on the client IP (RATE_LIMIT_TRUST_PROXY_DEPTH is unset or does not match the proxy chain); buckets fall back to the per-cart-token digest, so a caller minting fresh carts gets fresh buckets'
  if (process.env.NODE_ENV === 'production') {
    logger.error(message, { trustProxyDepth })
    getTelemetryRuntime()?.reportError(new Error(message), {
      module: 'assisted_selling',
      code: 'assisted_selling.rate_limit_client_ip_unavailable',
    })
    return
  }
  logger.warn(message, { trustProxyDepth })
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
    logger.warn('Assisted-selling buyer rate limiter unavailable', { err: error })
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

const FAIL_CLOSED_ENDPOINTS: ReadonlySet<AssistedSellingBuyerRateLimitEndpoint> = new Set(['open', 'message'])

function digestToken(token: string): string {
  return createHash('sha256').update(`assisted_selling:rate-limit:${token}`).digest('hex')
}

/** Never contains the raw guest token — the key is shared with the memory/Redis limiter. */
export function buildAssistedSellingRateLimitKey(clientIp: string | null, token: string | null): string {
  const tokenPart = token ? `t:${digestToken(token)}` : null
  if (clientIp && tokenPart) return `${clientIp}:${tokenPart}`
  return clientIp ?? tokenPart ?? 'anonymous'
}

async function resolveUnavailableMessage(): Promise<string> {
  try {
    const { translate } = await resolveTranslations()
    return translate(RATE_LIMIT_UNAVAILABLE_KEY, RATE_LIMIT_UNAVAILABLE_FALLBACK)
  } catch {
    return RATE_LIMIT_UNAVAILABLE_FALLBACK
  }
}

async function unavailableResponse(): Promise<NextResponse> {
  const response = NextResponse.json({ error: await resolveUnavailableMessage() }, { status: 503 })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/**
 * §6.2: "Public, cart-token bound, rate limited per IP and per token." Keys by
 * `ip:digest(token)`; when the client IP is unavailable the key degrades to the token digest
 * alone (never skipping the limit). The POST buckets (`open`, `message`) fail closed — a
 * missing limiter, a degraded backing store or a limiter error answers `503` — while the
 * read buckets stay fail-open, mirroring `cart/lib/rateLimit.ts`.
 */
export async function enforceAssistedSellingBuyerRateLimit(
  container: AppContainer,
  req: Request,
  endpoint: AssistedSellingBuyerRateLimitEndpoint,
  token: string | null,
): Promise<NextResponse | null> {
  const failClosed = FAIL_CLOSED_ENDPOINTS.has(endpoint)
  const limiter = resolveRateLimiter(container)
  if (!limiter) return failClosed ? unavailableResponse() : null
  try {
    const clientIp = getClientIp(req, limiter.trustProxyDepth)
    if (!clientIp) flagUnusableClientIp(limiter.trustProxyDepth)
    const key = buildAssistedSellingRateLimitKey(clientIp, token)
    const limited = await checkRateLimit(
      limiter,
      readAssistedSellingBuyerRateLimitConfig(endpoint),
      key,
      await resolveRateLimitMessage(),
      failClosed ? { failClosed: true, unavailableMessage: await resolveUnavailableMessage() } : {},
    )
    limited?.headers.set('Cache-Control', 'no-store')
    return limited
  } catch (error) {
    logger.warn('Assisted-selling buyer rate limit check failed', { err: error, endpoint, failClosed })
    getTelemetryRuntime()?.reportError(error, { module: 'assisted_selling', code: 'assisted_selling.rate_limit_failed' })
    return failClosed ? unavailableResponse() : null
  }
}
