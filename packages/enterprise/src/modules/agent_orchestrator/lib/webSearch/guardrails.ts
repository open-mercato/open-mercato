import type { AwilixContainer } from 'awilix'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { WebSearchRuntimeConfig } from './config'

export type WebSearchRateScope = {
  runId: string | null
  tenantId: string | null
}

export type RateLimitOutcome = { ok: true } | { ok: false; error: string }

/**
 * Enforces the per-run and per-tenant call ceilings via the canonical
 * `rateLimiterService`. Permissive by design: if no rate limiter is registered
 * (e.g. it is disabled in this process), the call is allowed. The per-run key is
 * a long-window total budget (the run is short-lived so the key expires with it);
 * the per-tenant key is a rolling one-minute window.
 */
export async function enforceWebSearchRateLimit(
  container: AwilixContainer,
  scope: WebSearchRateScope,
  config: WebSearchRuntimeConfig,
): Promise<RateLimitOutcome> {
  let limiter: RateLimiterService | null = null
  try {
    const hasRegistration =
      typeof container.hasRegistration === 'function' ? container.hasRegistration.bind(container) : null
    if (hasRegistration && !hasRegistration('rateLimiterService')) return { ok: true }
    limiter = container.resolve('rateLimiterService') as RateLimiterService
  } catch {
    return { ok: true }
  }
  if (!limiter) return { ok: true }

  if (scope.tenantId) {
    const result = await limiter.consume(`agentweb:tenant:${scope.tenantId}`, {
      points: config.ratePerTenantPerMinute,
      duration: 60,
      keyPrefix: 'agentweb',
    })
    if (!result.allowed) return { ok: false, error: 'web tool rate limit exceeded for tenant' }
  }

  if (scope.runId) {
    const result = await limiter.consume(`agentweb:run:${scope.runId}`, {
      points: config.ratePerRun,
      duration: 86_400,
      keyPrefix: 'agentweb',
    })
    if (!result.allowed) return { ok: false, error: 'web tool call budget exceeded for this run' }
  }

  return { ok: true }
}
