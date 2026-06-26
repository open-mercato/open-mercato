import type { NextResponse } from 'next/server'
import {
  checkRateLimit,
  RATE_LIMIT_ERROR_KEY,
  RATE_LIMIT_ERROR_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'

/** Minimal structural view of the request DI container used to resolve services. */
interface ResolvableContainer {
  resolve<T>(name: string): T
}

/**
 * Per-user / per-tenant rate limit defaults for the AI chat dispatch routes.
 * The AI chat endpoints are the platform's most expensive surface — each turn
 * runs the full LLM agent loop, performs several per-request DB lookups, persists
 * conversation rows, and buffers the SSE response in memory. A generous default
 * (30 turns/min/user) bounds a misbehaving client without disrupting legitimate
 * multi-turn sessions, and can be tuned via the `RATE_LIMIT_AI_CHAT_*` env vars.
 */
const AI_CHAT_RATE_LIMIT_DEFAULTS = {
  points: 30,
  duration: 60,
  keyPrefix: 'ai_chat',
} as const

export interface CheckAiChatRateLimitOptions {
  req: Request
  /** Request-scoped DI container; the rate limiter service is resolved from it. */
  container: ResolvableContainer
  userId: string
  tenantId: string | null | undefined
}

/**
 * Fail-open rate limit check for the AI chat dispatch routes.
 *
 * Resolves the `rateLimiterService` from the request container (the limiter is
 * registered as a DI value in bootstrap; `@open-mercato/core` is not a dependency
 * of this package, so it must come through DI rather than a static import).
 * Keyed on `userId` + `tenantId` so the ceiling is per-user-per-tenant.
 *
 * Returns a 429 `NextResponse` when the bucket is exhausted, or `null` when the
 * request is allowed. Mirrors auth's `checkAuthRateLimit`: when the limiter
 * service is unavailable (not registered, throws, or globally disabled) the
 * request proceeds unthrottled, so the change is non-breaking.
 */
export async function checkAiChatRateLimit(
  options: CheckAiChatRateLimitOptions,
): Promise<NextResponse | null> {
  try {
    // Opt-in test mode mirrors auth's `x-om-test-rate-limit` pattern so suites can
    // exercise the bucket without throttling unrelated requests.
    const isIntegrationTestMode =
      process.env.OM_TEST_MODE === '1' && process.env.OM_TEST_AI_CHAT_RATE_LIMIT_MODE === 'opt-in'
    if (isIntegrationTestMode && options.req.headers.get('x-om-test-rate-limit') !== 'on') {
      return null
    }

    let rateLimiterService: RateLimiterService | null = null
    try {
      rateLimiterService = options.container.resolve<RateLimiterService>('rateLimiterService')
    } catch {
      // Limiter not registered in this container — fail open.
      return null
    }
    if (!rateLimiterService) return null

    const config = readEndpointRateLimitConfig('AI_CHAT', AI_CHAT_RATE_LIMIT_DEFAULTS)
    const key = `${options.userId}:${options.tenantId ?? 'no-tenant'}`

    const { translate } = await resolveTranslations()
    const errorMessage = translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)

    return await checkRateLimit(rateLimiterService, config, key, errorMessage)
  } catch {
    // Fail open on any unexpected error — never block a legitimate turn because
    // the limiter misbehaved.
    return null
  }
}
