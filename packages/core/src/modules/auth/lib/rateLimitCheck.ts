import { NextResponse } from 'next/server'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'

export interface CheckAuthRateLimitOptions {
  req: Request
  ipConfig: RateLimitConfig
  compoundConfig?: RateLimitConfig
  /** Raw identifier for compound key (e.g., email). Hashed internally before use. */
  compoundIdentifier?: string
}

export interface CheckAuthRateLimitResult {
  error: NextResponse | null
  compoundKey: string | null
}

/**
 * Fail-open rate limit check for auth endpoints.
 * Layer 1: IP-only check with ipConfig.
 * Layer 2 (optional): compound IP + hashed identifier check with compoundConfig.
 */
export async function checkAuthRateLimit(options: CheckAuthRateLimitOptions): Promise<CheckAuthRateLimitResult> {
  try {
    const rateLimiterService = getCachedRateLimiterService()
    if (!rateLimiterService) return { error: null, compoundKey: null }

    const clientIp = getClientIp(options.req, rateLimiterService.trustProxyDepth)
    if (!clientIp) return { error: null, compoundKey: null }

    const { translate } = await resolveTranslations()
    const errorMessage = translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)

    const ipError = await checkRateLimit(rateLimiterService, options.ipConfig, clientIp, errorMessage)
    if (ipError) return { error: ipError, compoundKey: null }

    if (options.compoundConfig && options.compoundIdentifier) {
      const hash = computeEmailHash(options.compoundIdentifier)
      const compoundKey = `${clientIp}:${hash}`
      const compoundError = await checkRateLimit(rateLimiterService, options.compoundConfig, compoundKey, errorMessage)
      if (compoundError) return { error: compoundError, compoundKey }
      return { error: null, compoundKey }
    }

    return { error: null, compoundKey: null }
  } catch {
    return { error: null, compoundKey: null }
  }
}

/**
 * Best-effort reset of a compound rate-limit key after successful authentication.
 * Never throws — wrapped in try/catch.
 */
export async function resetAuthRateLimit(compoundKey: string, config: RateLimitConfig): Promise<void> {
  try {
    const rateLimiterService = getCachedRateLimiterService()
    if (rateLimiterService) {
      await rateLimiterService.delete(compoundKey, config)
    }
  } catch {
    // best-effort — don't fail the request if counter reset fails
  }
}
