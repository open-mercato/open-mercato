import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR_KEY,
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_FALLBACK_KEY,
  RATE_LIMIT_UNAVAILABLE_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import { buildScimError, scimJson } from '../../lib/scim-response'

export async function checkScimRateLimit(req: Request): Promise<Response | null> {
  const limiter = getCachedRateLimiterService()
  const config = readEndpointRateLimitConfig('SCIM', {
    points: 10,
    duration: 1,
    keyPrefix: 'sso-scim',
  })
  const limited = limiter
    ? await checkRateLimit(
      limiter,
      config,
      getClientIp(req, limiter.trustProxyDepth) ?? RATE_LIMIT_FALLBACK_KEY,
      RATE_LIMIT_ERROR_FALLBACK,
      { failClosed: true },
    )
    : new Response(null, { status: 503 })
  if (!limited) return null

  const { translate } = await resolveTranslations()
  const detail = limited.status === 429
    ? translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)
    : translate(RATE_LIMIT_UNAVAILABLE_KEY, RATE_LIMIT_UNAVAILABLE_FALLBACK)
  const response = scimJson(buildScimError(limited.status, detail), limited.status)
  limited.headers.forEach((value, name) => {
    if (name !== 'content-type') response.headers.set(name, value)
  })
  return response
}
