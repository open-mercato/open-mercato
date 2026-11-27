import { NextResponse } from 'next/server'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK, RATE_LIMIT_FALLBACK_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'

export interface CheckAuthRateLimitOptions {
  req: Request
  ipConfig: RateLimitConfig
  ipCheck?: 'trusted-only' | 'untrusted-only'
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
 * Layer 1: IP check with ipConfig. Without a trusted address, opted-in callers
 * check the identifier quota first while retaining the shared fallback ceiling.
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
    if (options.ipCheck === 'trusted-only' && !clientIp) {
      return { error: null, compoundKey: null }
    }
    const clientKey = clientIp ?? RATE_LIMIT_FALLBACK_KEY

    const { translate } = await resolveTranslations()
    const errorMessage = translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)

    const compoundKey = options.compoundConfig && options.compoundIdentifier
      ? `${clientKey}:${computeEmailHash(options.compoundIdentifier)}`
      : null
<<<<<<< HEAD
    const identifierFirst = Boolean(!clientIp && options.isolateByIdentifierWithoutTrustedIp && options.compoundConfig && compoundKey)
    let aggregateConsumed = false
    if (identifierFirst && options.compoundConfig && compoundKey) {
      const aggregateState = await rateLimiterService.get(clientKey, options.ipConfig).catch((error) => {
        try {
          getTelemetryRuntime()?.reportError(error, { module: 'auth', code: 'auth.fallback_rate_limit_read_failed' })
        } catch {
          return null
        }
        return null
      })
      if (aggregateState && !aggregateState.allowed) {
        const aggregateError = await checkRateLimit(rateLimiterService, options.ipConfig, clientKey, errorMessage)
        if (aggregateError) return { error: aggregateError, compoundKey: null }
        aggregateConsumed = true
      }
      const identifierError = await checkRateLimit(rateLimiterService, options.compoundConfig, compoundKey, errorMessage)
      if (identifierError) return { error: identifierError, compoundKey }
=======
    const ipKey = !clientIp && options.isolateByIdentifierWithoutTrustedIp && compoundKey
      ? `identifier:${compoundKey}`
      : clientKey
    if (options.ipCheck !== 'untrusted-only' || !clientIp) {
      const ipError = await checkRateLimit(rateLimiterService, options.ipConfig, ipKey, errorMessage)
      if (ipError) return { error: ipError, compoundKey: null }
>>>>>>> 9934e0940a (fix(security): harden platform authorization and deployment defaults (#10543))
    }

    if (!aggregateConsumed) {
      const ipError = await checkRateLimit(rateLimiterService, options.ipConfig, clientKey, errorMessage)
      if (ipError) return { error: ipError, compoundKey: null }
    }

    if (!identifierFirst && options.compoundConfig && compoundKey) {
      const compoundError = await checkRateLimit(rateLimiterService, options.compoundConfig, compoundKey, errorMessage)
      if (compoundError) return { error: compoundError, compoundKey }
      return { error: null, compoundKey }
    }

    return { error: null, compoundKey }
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
