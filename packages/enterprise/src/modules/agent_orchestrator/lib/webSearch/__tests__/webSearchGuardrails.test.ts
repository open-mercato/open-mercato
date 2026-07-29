import type { AwilixContainer } from 'awilix'
import { MODEL_ADAPTER_TIMEOUT_MS, resolvePolicy } from '@open-mercato/web-research'
import { enforceWebSearchRateLimit, resolveRunId } from '../guardrails'
import { hostnameOf, isHostAllowed, resolveEnvSettings, type WebSearchGuardrails } from '../policy'

const guardrails: WebSearchGuardrails = {
  allowDomains: [],
  denyDomains: [],
  searchesPerRun: 20,
  fetchesPerRun: 40,
  callsPerTenantPerMinute: 120,
  maxFetchBytes: 64 * 1024,
}

type ConsumeResult = { allowed: boolean }

function containerWith(overrides: {
  limiter?: { consume: jest.Mock<Promise<ConsumeResult>, [string, unknown]> } | null
  limiterThrows?: boolean
  sessionStore?: { resolveActiveRunId: jest.Mock<Promise<string | null>, [string]> }
}): AwilixContainer {
  return {
    hasRegistration: (key: string) => {
      if (key === 'rateLimiterService') return overrides.limiter !== undefined || overrides.limiterThrows === true
      if (key === 'agentRunSessionStore') return overrides.sessionStore !== undefined
      return false
    },
    resolve: (key: string) => {
      if (key === 'rateLimiterService') {
        if (overrides.limiterThrows) throw new Error('limiter is misconfigured')
        return overrides.limiter
      }
      if (key === 'agentRunSessionStore') {
        if (!overrides.sessionStore) throw new Error('not registered')
        return overrides.sessionStore
      }
      throw new Error(`unexpected resolve: ${key}`)
    },
  } as unknown as AwilixContainer
}

const allowingLimiter = () => ({ consume: jest.fn(async () => ({ allowed: true })) })

describe('resolveEnvSettings', () => {
  it('enables only model-native by default, keeping SERP scraping opt-in', () => {
    const settings = resolveEnvSettings({})
    expect(settings.policy.adapters).toEqual([
      { id: 'model-native', enabled: true, order: 0, weight: 1, timeoutMs: MODEL_ADAPTER_TIMEOUT_MS },
    ])
  })

  it('gives the default adapter a budget it can actually finish in', () => {
    // model-native runs the model's own multi-step web search and measures around
    // 30s. Under the generic adapter budget it timed out on every run, so the
    // shipped configuration returned nothing at all.
    const settings = resolveEnvSettings({})
    const modelNative = settings.policy.adapters?.find((entry) => entry.id === 'model-native')
    expect(modelNative?.timeoutMs).toBeGreaterThan(30_000)
    expect(resolvePolicy(settings.policy).hardDeadlineMs).toBeGreaterThanOrEqual(modelNative?.timeoutMs ?? 0)
  })

  it('enables the listed adapters in the given order', () => {
    const settings = resolveEnvSettings({ OM_WEB_SEARCH_ADAPTERS: 'serp-html, model-native' } as NodeJS.ProcessEnv)
    expect(settings.policy.adapters?.map((entry) => entry.id)).toEqual(['serp-html', 'model-native'])
    expect(settings.policy.adapters?.map((entry) => entry.order)).toEqual([0, 1])
  })

  it('normalizes domain lists and ceilings', () => {
    const settings = resolveEnvSettings({
      OM_WEB_SEARCH_ALLOW_DOMAINS: 'Example.com, news.example.org',
      OM_WEB_SEARCH_DENY_DOMAINS: 'evil.test',
      OM_WEB_SEARCH_RATE_PER_RUN: '3',
      OM_WEB_FETCH_RATE_PER_RUN: '7',
    } as NodeJS.ProcessEnv)
    expect(settings.guardrails.allowDomains).toEqual(['example.com', 'news.example.org'])
    expect(settings.guardrails.denyDomains).toEqual(['evil.test'])
    expect(settings.guardrails.searchesPerRun).toBe(3)
    expect(settings.guardrails.fetchesPerRun).toBe(7)
  })
})

describe('isHostAllowed', () => {
  it('allows everything when neither list is set', () => {
    expect(isHostAllowed('example.com', guardrails)).toBe(true)
  })

  it('matches on a dot boundary, not a bare suffix', () => {
    const scoped = { ...guardrails, allowDomains: ['example.com'] }
    expect(isHostAllowed('news.example.com', scoped)).toBe(true)
    expect(isHostAllowed('notexample.com', scoped)).toBe(false)
  })

  it('lets deny win over allow', () => {
    const scoped = { ...guardrails, allowDomains: ['example.com'], denyDomains: ['secret.example.com'] }
    expect(isHostAllowed('secret.example.com', scoped)).toBe(false)
  })
})

describe('hostnameOf', () => {
  it('lowercases the host and returns null for junk', () => {
    expect(hostnameOf('https://Example.COM/a')).toBe('example.com')
    expect(hostnameOf('not a url')).toBeNull()
  })
})

describe('resolveRunId', () => {
  // The whole point of this lookup: in the mcp:serve-http process the
  // AsyncLocalStorage run context is always empty, so the per-run budget used to
  // be skipped on the primary file-agent path.
  it('reads the run id from the session store when there is no in-process context', async () => {
    const sessionStore = { resolveActiveRunId: jest.fn(async () => 'run-42') }
    const container = containerWith({ sessionStore })

    await expect(resolveRunId(container, 'session-token')).resolves.toBe('run-42')
    expect(sessionStore.resolveActiveRunId).toHaveBeenCalledWith('session-token')
  })

  it('returns null without a session token', async () => {
    await expect(resolveRunId(containerWith({}), null)).resolves.toBeNull()
  })

  it('returns null when the store is unavailable', async () => {
    await expect(resolveRunId(containerWith({}), 'token')).resolves.toBeNull()
  })
})

describe('enforceWebSearchRateLimit', () => {
  it('allows when no limiter is registered at all', async () => {
    const container = {
      hasRegistration: () => false,
      resolve: () => {
        throw new Error('nope')
      },
    } as unknown as AwilixContainer

    await expect(
      enforceWebSearchRateLimit(container, { runId: 'r', tenantId: 't', kind: 'search' }, guardrails),
    ).resolves.toEqual({ ok: true })
  })

  it('fails closed when a limiter is registered but unusable', async () => {
    const container = containerWith({ limiterThrows: true })

    const outcome = await enforceWebSearchRateLimit(
      container,
      { runId: 'r', tenantId: 't', kind: 'search' },
      guardrails,
    )

    expect(outcome).toEqual({ ok: false, error: 'web tool rate limiter is unavailable' })
  })

  it('charges search and fetch to separate per-run budgets', async () => {
    const limiter = allowingLimiter()
    const container = containerWith({ limiter })

    await enforceWebSearchRateLimit(container, { runId: 'r1', tenantId: null, kind: 'search' }, guardrails)
    await enforceWebSearchRateLimit(container, { runId: 'r1', tenantId: null, kind: 'fetch' }, guardrails)

    const keys = limiter.consume.mock.calls.map((call) => call[0])
    expect(keys).toEqual(['agentweb:search:run:r1', 'agentweb:fetch:run:r1'])
    expect(limiter.consume.mock.calls[0][1]).toMatchObject({ points: guardrails.searchesPerRun })
    expect(limiter.consume.mock.calls[1][1]).toMatchObject({ points: guardrails.fetchesPerRun })
  })

  it('rejects when the tenant window is exhausted', async () => {
    const limiter = { consume: jest.fn(async () => ({ allowed: false })) }
    const container = containerWith({ limiter })

    await expect(
      enforceWebSearchRateLimit(container, { runId: 'r', tenantId: 't', kind: 'search' }, guardrails),
    ).resolves.toEqual({ ok: false, error: 'web tool rate limit exceeded for tenant' })
  })

  it('rejects when the per-run budget is exhausted', async () => {
    const limiter = {
      consume: jest.fn(async (key: string) => ({ allowed: !key.startsWith('agentweb:search:run') })),
    }
    const container = containerWith({ limiter })

    await expect(
      enforceWebSearchRateLimit(container, { runId: 'r', tenantId: 't', kind: 'search' }, guardrails),
    ).resolves.toEqual({ ok: false, error: 'web search budget exceeded for this run' })
  })

  it('skips the per-run check when the run is unknown', async () => {
    const limiter = allowingLimiter()
    const container = containerWith({ limiter })

    await enforceWebSearchRateLimit(container, { runId: null, tenantId: 't', kind: 'search' }, guardrails)

    expect(limiter.consume.mock.calls.map((call) => call[0])).toEqual(['agentweb:tenant:t'])
  })
})
