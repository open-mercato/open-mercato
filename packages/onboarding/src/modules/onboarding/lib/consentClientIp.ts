import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'

/**
 * Resolve the client IP to persist on a legal-consent record, honoring the
 * deployment-wide reverse-proxy trust depth (`RATE_LIMIT_TRUST_PROXY_DEPTH`)
 * exposed by the rate limiter service instead of a hardcoded depth. When the
 * trust depth is unknown, return null so spoofable proxy headers are never
 * signed into the consent integrity hash.
 */
export function resolveConsentClientIp(req: Request): string | null {
  const rateLimiterService = getCachedRateLimiterService()
  if (!rateLimiterService) return null
  return getClientIp(req, rateLimiterService.trustProxyDepth) ?? null
}
