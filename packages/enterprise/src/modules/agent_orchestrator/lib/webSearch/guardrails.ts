import type { AwilixContainer } from 'awilix'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { AgentRunSessionStore } from '../runtime/agentRunSessionStore'
import { getCurrentRunId } from '../runtime/runContext'
import type { WebSearchGuardrails } from './policy'

export type WebSearchRateScope = {
  readonly runId: string | null
  readonly tenantId: string | null
  readonly kind: 'search' | 'fetch'
}

export type RateLimitOutcome = { ok: true } | { ok: false; error: string }

/**
 * Resolves the run this call belongs to.
 *
 * `getCurrentRunId()` reads an AsyncLocalStorage that only the in-process runner
 * populates. File agents - the primary path - reach these tools through the
 * separate `mcp:serve-http` process, where it is always empty, so the per-run
 * budget silently never applied. The session store is the cross-process
 * correlation point and is authoritative here.
 */
export async function resolveRunId(
  container: AwilixContainer,
  sessionToken: string | null | undefined,
): Promise<string | null> {
  const inProcess = getCurrentRunId()
  if (inProcess) return inProcess
  if (!sessionToken) return null
  try {
    const store = container.resolve('agentRunSessionStore') as AgentRunSessionStore
    return await store.resolveActiveRunId(sessionToken)
  } catch {
    return null
  }
}

function resolveLimiter(container: AwilixContainer): RateLimiterService | 'absent' | 'broken' {
  const hasRegistration =
    typeof container.hasRegistration === 'function' ? container.hasRegistration.bind(container) : null
  if (hasRegistration && !hasRegistration('rateLimiterService')) return 'absent'
  try {
    const limiter = container.resolve('rateLimiterService') as RateLimiterService | null
    return limiter ?? 'absent'
  } catch {
    // Registered but unusable. Treated differently from "not registered": a
    // deployment that configured a limiter and lost it must not silently drop
    // its ceilings.
    return 'broken'
  }
}

/**
 * Enforces per-run and per-tenant call ceilings. Fails **open** only when no
 * limiter is registered at all, and **closed** when one is registered but
 * unusable. Search and fetch have separate per-run budgets so a page-reading
 * loop cannot exhaust the allowance for discovery.
 */
export async function enforceWebSearchRateLimit(
  container: AwilixContainer,
  scope: WebSearchRateScope,
  guardrails: WebSearchGuardrails,
): Promise<RateLimitOutcome> {
  const limiter = resolveLimiter(container)
  if (limiter === 'absent') return { ok: true }
  if (limiter === 'broken') {
    return { ok: false, error: 'web tool rate limiter is unavailable' }
  }

  if (scope.tenantId) {
    const result = await limiter.consume(`agentweb:tenant:${scope.tenantId}`, {
      points: guardrails.callsPerTenantPerMinute,
      duration: 60,
      keyPrefix: 'agentweb',
    })
    if (!result.allowed) return { ok: false, error: 'web tool rate limit exceeded for tenant' }
  }

  if (scope.runId) {
    const points = scope.kind === 'search' ? guardrails.searchesPerRun : guardrails.fetchesPerRun
    const result = await limiter.consume(`agentweb:${scope.kind}:run:${scope.runId}`, {
      points,
      duration: 86_400,
      keyPrefix: 'agentweb',
    })
    if (!result.allowed) {
      return { ok: false, error: `web ${scope.kind} budget exceeded for this run` }
    }
  }

  return { ok: true }
}
