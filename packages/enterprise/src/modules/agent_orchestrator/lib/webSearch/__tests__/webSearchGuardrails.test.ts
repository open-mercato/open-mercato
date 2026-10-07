import type { AwilixContainer } from 'awilix'
import { MODEL_ADAPTER_TIMEOUT_MS, resolvePolicy } from '@open-mercato/web-research'
import {
  chargeAdapterCalls,
  chargeWebFetchBudget,
  enforceWebSearchRateLimit,
  resolveRunId,
  resolveSpentAdapterBudgets,
} from '../guardrails'
import {
  hostnameOf,
  isHostAllowed,
  resolveEnvSettings,
  withModelAdapterBudget,
  type WebSearchGuardrails,
} from '../policy'

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

  it('backfills the model budget on a stored policy that never named one', () => {
    // A stored adapter list replaces the env-derived one outright, so every
    // tenant who saved from the settings page has a model-native row with no
    // timeout, and the shared 8s budget times it out on every single run.
    const stored = resolvePolicy({
      adapters: [
        { id: 'model-native', enabled: true, order: 0, weight: 1 },
        { id: 'serp-html', enabled: true, order: 1, weight: 1 },
      ],
      hardDeadlineMs: 15_000,
    })
    expect(stored.adapters.find((entry) => entry.id === 'model-native')?.timeoutMs).toBeUndefined()

    const patched = withModelAdapterBudget(stored)

    expect(patched.adapters.find((entry) => entry.id === 'model-native')?.timeoutMs).toBe(
      MODEL_ADAPTER_TIMEOUT_MS,
    )
    // A budget past the hard deadline can never be reached, so the ceiling moves with it.
    expect(patched.hardDeadlineMs).toBeGreaterThanOrEqual(MODEL_ADAPTER_TIMEOUT_MS)
    expect(patched.adapters.find((entry) => entry.id === 'serp-html')?.timeoutMs).toBeUndefined()
  })

  it('leaves an explicitly chosen model budget alone', () => {
    const chosen = resolvePolicy({
      adapters: [{ id: 'model-native', enabled: true, order: 0, weight: 1, timeoutMs: 5_000 }],
    })
    expect(withModelAdapterBudget(chosen).adapters[0]?.timeoutMs).toBe(5_000)
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

  it('refuses every private address unless a host is named', () => {
    expect(resolveEnvSettings({}).guardrails.allowPrivateHosts).toEqual([])
  })

  it('reads the private-host allowlist from env, normalized', () => {
    const settings = resolveEnvSettings({
      OM_WEB_SEARCH_ALLOW_PRIVATE_HOSTS: 'SearXNG, internal.example.com ,',
    } as NodeJS.ProcessEnv)
    expect(settings.guardrails.allowPrivateHosts).toEqual(['searxng', 'internal.example.com'])
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

describe('chargeWebFetchBudget', () => {
  const limiterWithPenalty = () => ({
    consume: jest.fn(async () => ({ allowed: true })),
    penalty: jest.fn(async () => ({ allowed: true })),
  })

  it('charges the fetch budget for pages a search read', async () => {
    // Without this, includeContent reads up to maxPages under one search point
    // and fetchesPerRun never engages on the path the tool description promotes.
    const limiter = limiterWithPenalty()
    const container = containerWith({ limiter: limiter as never })

    await chargeWebFetchBudget(container, 'run-1', guardrails, 3)

    expect(limiter.penalty).toHaveBeenCalledWith(
      'agentweb:fetch:run:run-1',
      3,
      expect.objectContaining({ points: guardrails.fetchesPerRun }),
    )
  })

  it('charges nothing when no page was read', async () => {
    const limiter = limiterWithPenalty()
    await chargeWebFetchBudget(containerWith({ limiter: limiter as never }), 'run-1', guardrails, 0)
    expect(limiter.penalty).not.toHaveBeenCalled()
  })

  it('never throws when accounting is unavailable', async () => {
    const container = containerWith({ limiterThrows: true })
    await expect(chargeWebFetchBudget(container, 'run-1', guardrails, 2)).resolves.toBeUndefined()
  })
})

describe('adapter call ceilings', () => {
  const budgeted = [
    { id: 'model-native', maxCallsPerHour: 100 },
    { id: 'serp-html' },
  ]

  it('reports an adapter whose ceiling is spent', async () => {
    const limiter = {
      consume: jest.fn(async () => ({ allowed: true })),
      get: jest.fn(async (key: string) => (key.includes('model-native') ? { allowed: false } : null)),
    }
    const spent = await resolveSpentAdapterBudgets(
      containerWith({ limiter: limiter as never }),
      'tenant-1',
      budgeted,
    )
    expect([...spent]).toEqual(['model-native'])
  })

  it('never asks about an adapter with no ceiling', async () => {
    const limiter = { consume: jest.fn(), get: jest.fn(async () => null) }
    await resolveSpentAdapterBudgets(containerWith({ limiter: limiter as never }), 'tenant-1', budgeted)
    expect(limiter.get).toHaveBeenCalledTimes(1)
    expect(limiter.get.mock.calls[0][0]).toContain('model-native')
  })

  it('charges only adapters that actually ran and carry a ceiling', async () => {
    // Quorum often settles before the expensive adapter is reached; billing for a
    // call that never happened would exhaust a ceiling that cost nothing.
    const limiter = { consume: jest.fn(async () => ({ allowed: true })), get: jest.fn() }
    await chargeAdapterCalls(containerWith({ limiter: limiter as never }), 'tenant-1', budgeted, [
      'serp-html',
      'model-native',
    ])
    expect(limiter.consume).toHaveBeenCalledTimes(1)
    expect(limiter.consume.mock.calls[0][0]).toBe('agentweb:adapter:tenant-1:model-native')
  })

  it('fails open when no limiter is registered', async () => {
    const container = {
      hasRegistration: () => false,
      resolve: () => {
        throw new Error('nope')
      },
    } as unknown as AwilixContainer
    await expect(resolveSpentAdapterBudgets(container, 't', budgeted)).resolves.toEqual(new Set())
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
