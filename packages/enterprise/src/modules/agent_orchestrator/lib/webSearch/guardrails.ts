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
/**
 * Charges pages a search already read against the fetch budget.
 *
 * `web_search` costs one search point no matter how many pages `includeContent`
 * reads, so an agent could pull `maxPages` per call and never touch
 * `fetchesPerRun` — and the tool description actively steers it there, which made
 * the separate discovery and reading budgets trivially bypassable. Charged after
 * the fact because the count is not known until the read is done: a run can
 * overshoot by one call, and the next one is refused.
 */
export async function chargeWebFetchBudget(
  container: AwilixContainer,
  runId: string | null,
  guardrails: WebSearchGuardrails,
  pages: number,
): Promise<void> {
  if (pages <= 0 || !runId) return
  const limiter = resolveLimiter(container)
  if (limiter === 'absent' || limiter === 'broken') return
  try {
    await limiter.penalty(`agentweb:fetch:run:${runId}`, pages, {
      points: guardrails.fetchesPerRun,
      duration: 86_400,
      keyPrefix: 'agentweb',
    })
  } catch {
    // Accounting must never fail a search the caller already paid for.
  }
}

const ADAPTER_BUDGET_WINDOW_SECONDS = 3600

function adapterBudgetKey(tenantId: string | null, adapterId: string): string {
  return `agentweb:adapter:${tenantId ?? 'global'}:${adapterId}`
}

/**
 * Which adapters have spent their hourly call ceiling.
 *
 * A model doing its own web search is billed per search, and `lastResort` fires
 * it on every run that came up short — so without a ceiling a stuck agent loop
 * is an open tab at the vendor. Counted per adapter rather than per tool call
 * because the same tool costs nothing on a free SERP and real money on a model.
 *
 * Fails open when no limiter is registered, like the other ceilings here: losing
 * web search entirely is worse than losing the cap.
 */
export async function resolveSpentAdapterBudgets(
  container: AwilixContainer,
  tenantId: string | null,
  adapters: ReadonlyArray<{ id: string; maxCallsPerHour?: number }>,
): Promise<ReadonlySet<string>> {
  const budgeted = adapters.filter((entry) => (entry.maxCallsPerHour ?? 0) > 0)
  if (budgeted.length === 0) return new Set()
  const limiter = resolveLimiter(container)
  if (limiter === 'absent' || limiter === 'broken') return new Set()

  const spent = new Set<string>()
  await Promise.all(
    budgeted.map(async (entry) => {
      try {
        const result = await limiter.get(adapterBudgetKey(tenantId, entry.id), {
          points: entry.maxCallsPerHour as number,
          duration: ADAPTER_BUDGET_WINDOW_SECONDS,
          keyPrefix: 'agentweb',
        })
        if (result && !result.allowed) spent.add(entry.id)
      } catch {
        // Reading a ceiling must never fail the search it was meant to bound.
      }
    }),
  )
  return spent
}

/** Records the calls that actually happened, so the next run sees the ceiling. */
export async function chargeAdapterCalls(
  container: AwilixContainer,
  tenantId: string | null,
  adapters: ReadonlyArray<{ id: string; maxCallsPerHour?: number }>,
  calledIds: readonly string[],
): Promise<void> {
  const budgets = new Map(
    adapters
      .filter((entry) => (entry.maxCallsPerHour ?? 0) > 0)
      .map((entry) => [entry.id, entry.maxCallsPerHour as number]),
  )
  const charged = calledIds.filter((id) => budgets.has(id))
  if (charged.length === 0) return
  const limiter = resolveLimiter(container)
  if (limiter === 'absent' || limiter === 'broken') return
  await Promise.all(
    charged.map(async (id) => {
      try {
        await limiter.consume(adapterBudgetKey(tenantId, id), {
          points: budgets.get(id) as number,
          duration: ADAPTER_BUDGET_WINDOW_SECONDS,
          keyPrefix: 'agentweb',
        })
      } catch {
        // Accounting must never fail a search the caller already paid for.
      }
    }),
  )
}

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
