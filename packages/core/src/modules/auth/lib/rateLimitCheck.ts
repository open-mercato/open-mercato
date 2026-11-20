import { NextResponse } from 'next/server'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK, RATE_LIMIT_FALLBACK_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'

export interface CheckAuthRateLimitOptions {
  req: Request
  ipConfig: RateLimitConfig
  compoundConfig?: RateLimitConfig
  isolateByIdentifierWithoutTrustedIp?: boolean
  /** Raw identifier for compound key (e.g., email). Hashed internally before use. */
  compoundIdentifier?: string
}

export interface CheckAuthRateLimitResult {
  error: NextResponse | null
  compoundKey: string | null
}

/**
 * Fail-open rate limit check for auth endpoints.
 * Layer 1: IP check with ipConfig. Opted-in callers with an identifier but no
 * trusted address scope this limit to the identifier.
 * Layer 2 (optional): compound IP + hashed identifier check with compoundConfig.
 */
export async function checkAuthRateLimit(options: CheckAuthRateLimitOptions): Promise<CheckAuthRateLimitResult> {
  try {
    const isIntegrationTestMode = process.env.OM_TEST_MODE === '1' && process.env.OM_TEST_AUTH_RATE_LIMIT_MODE === 'opt-in'
    if (isIntegrationTestMode) {
      const rateLimitHeader = options.req.headers.get('x-om-test-rate-limit')
      if (rateLimitHeader !== 'on') {
        return { error: null, compoundKey: null }
      }
    }

    const rateLimiterService = getCachedRateLimiterService()
    if (!rateLimiterService) return { error: null, compoundKey: null }

    const clientIp = getClientIp(options.req, rateLimiterService.trustProxyDepth)
    const clientKey = clientIp ?? RATE_LIMIT_FALLBACK_KEY

    const { translate } = await resolveTranslations()
    const errorMessage = translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)

    const compoundKey = options.compoundConfig && options.compoundIdentifier
      ? `${clientKey}:${computeEmailHash(options.compoundIdentifier)}`
      : null
    const ipKey = !clientIp && options.isolateByIdentifierWithoutTrustedIp && compoundKey
      ? `identifier:${compoundKey}`
      : clientKey
    const ipError = await checkRateLimit(rateLimiterService, options.ipConfig, ipKey, errorMessage)
    if (ipError) return { error: ipError, compoundKey: null }

    if (options.compoundConfig && compoundKey) {
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
