import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
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

const logger = createLogger('marketing_automation')

/**
 * The limits on this module's six unauthenticated routes.
 *
 * They were unlimited. Each inbound POST runs a bounded decrypt scan to resolve an address, and every
 * track/open and track/click writes a row — so a signed URL out of one recipient's mailbox was enough to
 * grow a table without bound, and an inbound hook URL was enough to spend the scan repeatedly.
 *
 * Modelled on `checkout/lib/rateLimiter.ts`, down to the three outcomes it distinguishes, because a second
 * reading of the same problem in the same repository is a second thing to keep in step.
 */
export type MarketingRateLimitPosture = 'fail-open' | 'fail-closed'

type RateLimiterContainer = {
  resolve: (name: string) => unknown
  hasRegistration?: (name: string) => boolean
}

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
 * The thing being limited: the caller's address AND the credential they presented.
 *
 * IP alone would let one token be hammered from a botnet and would punish everybody behind a corporate NAT
 * for one colleague's mail client. The credential alone would let anybody mint fresh garbage tokens for ever.
 *
 * The credential is FINGERPRINTED, not used: a tracking token is a signed blob that appears in logs and
 * Redis keys, and the limiter's own storage is no place for one. Taken from the RAW parameter rather than
 * from verified claims, so the verification itself — a constant-time HMAC per configured secret — is behind
 * the limit too, and a forged token cannot land on another token's bucket.
 */
export function buildMarketingRateLimitKey(
  req: Request,
  rateLimiter: RateLimiterService,
  namespace: string,
  credential: string | null,
): string {
  const clientKey = getClientIp(req, rateLimiter.trustProxyDepth) ?? RATE_LIMIT_FALLBACK_KEY
  const fingerprint = credential
    ? createHash('sha256').update(credential).digest('hex').slice(0, 16)
    : 'anonymous'
  return `${namespace}:${clientKey}:${fingerprint}`
}

/**
 * Runs the guard for one request and returns the response to send instead of handling it, or null.
 *
 * Three outcomes, deliberately distinguished:
 *
 *  - the limiter is not registered at all → a configuration error, logged, and the check is skipped. That
 *    condition lasts until an operator fixes the environment, and reporting a public endpoint as
 *    temporarily unavailable for it would be a lie that never resolves.
 *  - the limiter is registered but could not decide → 503 under `fail-closed`, a logged warning under
 *    `fail-open`.
 *  - the quota is exhausted → the 429 from `checkRateLimit`, with `Retry-After`.
 */
export async function enforceMarketingRateLimit(options: {
  req: Request
  container: RateLimiterContainer
  config: RateLimitConfig
  namespace: string
  credential: string | null
  errorMessage: string
  posture: MarketingRateLimitPosture
}): Promise<NextResponse | null> {
  const { req, container, config, namespace, credential, errorMessage, posture } = options
  const rateLimiter = resolveOptionalRateLimiter(container)
  if (!rateLimiter) {
    logger.error(
      '[internal] rate limiter service is not registered — check RATE_LIMIT_* configuration; marketing public endpoints are not rate limited',
      { namespace, posture },
    )
    return null
  }

  try {
    const key = buildMarketingRateLimitKey(req, rateLimiter, namespace, credential)
    return await checkRateLimit(rateLimiter, config, key, errorMessage, {
      failClosed: posture === 'fail-closed',
    })
  } catch (error) {
    if (posture === 'fail-closed') {
      logger.error('[internal] marketing rate limit check failed, rejecting request', { err: error, namespace })
      return NextResponse.json({ error: RATE_LIMIT_UNAVAILABLE_FALLBACK }, { status: 503 })
    }
    logger.warn('[internal] marketing rate limit check failed, allowing request', { err: error, namespace })
    return null
  }
}

/**
 * Tracking: generous, and FAIL-OPEN.
 *
 * A pixel and a click redirect live in messages already delivered, and those cannot be fixed afterwards — so a
 * degraded limiter must not turn every link in every sent email into a 503. The damage a flood does here is a
 * junk row, which is bounded by the limit when the limiter works and cleaned up by nothing when it does not.
 *
 * Generous because one recipient legitimately opens a message many times, and image proxies refetch.
 */
export const trackingRateLimitConfig = readEndpointRateLimitConfig('MARKETING_TRACKING', {
  points: 120,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'marketing-tracking',
})

/**
 * Unsubscribe and survey: FAIL-CLOSED, because both change something.
 *
 * Tighter than tracking: a person unsubscribes once and answers one survey once, so anything beyond a handful
 * a minute is not a person.
 */
export const optOutRateLimitConfig = readEndpointRateLimitConfig('MARKETING_OPT_OUT', {
  points: 20,
  duration: 60,
  blockDuration: 120,
  keyPrefix: 'marketing-opt-out',
})

/**
 * Inbound hooks: FAIL-CLOSED, and the tightest of the three per credential.
 *
 * Every POST resolves an address through a bounded decrypt scan, which is the most expensive thing an
 * unauthenticated caller can ask this module to do. A partner system posting a legitimate event does so once
 * per event, so the window is sized for a burst rather than a stream.
 */
export const inboundRateLimitConfig = readEndpointRateLimitConfig('MARKETING_INBOUND', {
  points: 30,
  duration: 60,
  blockDuration: 120,
  keyPrefix: 'marketing-inbound',
})
