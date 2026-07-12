import type { AwilixContainer } from 'awilix'
import { hostnameOf, isHostAllowed, resolveWebSearchConfig } from '../config'
import { enforceWebSearchRateLimit } from '../guardrails'
import type { WebSearchRuntimeConfig } from '../config'

const baseConfig: WebSearchRuntimeConfig = {
  baseUrl: 'https://searxng.internal',
  maxResults: 10,
  maxBytes: 64 * 1024,
  timeoutMs: 10_000,
  allowDomains: [],
  denyDomains: [],
  ratePerRun: 20,
  ratePerTenantPerMinute: 120,
}

describe('resolveWebSearchConfig', () => {
  it('falls back to permissive defaults when env is empty', () => {
    const config = resolveWebSearchConfig({})
    expect(config.baseUrl).toBeNull()
    expect(config.maxResults).toBe(10)
    expect(config.maxBytes).toBe(65536)
    expect(config.allowDomains).toEqual([])
    expect(config.denyDomains).toEqual([])
    expect(config.ratePerRun).toBe(20)
  })

  it('reads and normalizes env values', () => {
    const config = resolveWebSearchConfig({
      OM_AGENT_WEB_SEARCH_BASE_URL: ' https://searxng.example ',
      OM_AGENT_WEB_SEARCH_MAX_RESULTS: '5',
      OM_AGENT_WEB_FETCH_MAX_BYTES: '2048',
      OM_AGENT_WEB_SEARCH_ALLOW_DOMAINS: 'Example.com, news.example.org',
      OM_AGENT_WEB_SEARCH_DENY_DOMAINS: 'evil.test',
      OM_AGENT_WEB_SEARCH_RATE_PER_RUN: '3',
    } as NodeJS.ProcessEnv)
    expect(config.baseUrl).toBe('https://searxng.example')
    expect(config.maxResults).toBe(5)
    expect(config.maxBytes).toBe(2048)
    expect(config.allowDomains).toEqual(['example.com', 'news.example.org'])
    expect(config.denyDomains).toEqual(['evil.test'])
    expect(config.ratePerRun).toBe(3)
  })

  it('ignores non-positive numeric overrides', () => {
    const config = resolveWebSearchConfig({ OM_AGENT_WEB_SEARCH_MAX_RESULTS: '0', OM_AGENT_WEB_SEARCH_TIMEOUT_MS: 'nope' } as NodeJS.ProcessEnv)
    expect(config.maxResults).toBe(10)
    expect(config.timeoutMs).toBe(10_000)
  })
})

describe('hostnameOf', () => {
  it('extracts and lowercases the host', () => {
    expect(hostnameOf('https://News.Example.com/path')).toBe('news.example.com')
  })
  it('returns null for an invalid URL', () => {
    expect(hostnameOf('not a url')).toBeNull()
  })
})

describe('isHostAllowed', () => {
  it('allows everything when no lists are set', () => {
    expect(isHostAllowed('anything.com', { allowDomains: [], denyDomains: [] })).toBe(true)
  })
  it('deny wins over allow', () => {
    expect(isHostAllowed('evil.com', { allowDomains: ['evil.com'], denyDomains: ['evil.com'] })).toBe(false)
  })
  it('deny matches subdomains at a dot boundary', () => {
    expect(isHostAllowed('ads.evil.com', { allowDomains: [], denyDomains: ['evil.com'] })).toBe(false)
    expect(isHostAllowed('notevil.com', { allowDomains: [], denyDomains: ['evil.com'] })).toBe(true)
  })
  it('allowlist restricts to listed domains and subdomains', () => {
    const cfg = { allowDomains: ['example.com'], denyDomains: [] }
    expect(isHostAllowed('example.com', cfg)).toBe(true)
    expect(isHostAllowed('news.example.com', cfg)).toBe(true)
    expect(isHostAllowed('other.org', cfg)).toBe(false)
  })
})

type Registry = Record<string, unknown>
function makeContainer(registry: Registry): AwilixContainer {
  return {
    resolve: (key: string) => {
      if (key in registry) return registry[key]
      throw new Error(`not registered: ${key}`)
    },
    hasRegistration: (key: string) => key in registry,
  } as unknown as AwilixContainer
}

describe('enforceWebSearchRateLimit', () => {
  it('allows when no rate limiter is registered (permissive)', async () => {
    const result = await enforceWebSearchRateLimit(makeContainer({}), { runId: 'r1', tenantId: 't1' }, baseConfig)
    expect(result.ok).toBe(true)
  })

  it('allows when the limiter permits both windows', async () => {
    const consume = jest.fn(async () => ({ allowed: true, remainingPoints: 5, msBeforeNext: 0, consumedPoints: 1 }))
    const container = makeContainer({ rateLimiterService: { consume } })
    const result = await enforceWebSearchRateLimit(container, { runId: 'r1', tenantId: 't1' }, baseConfig)
    expect(result.ok).toBe(true)
    expect(consume).toHaveBeenCalledTimes(2)
  })

  it('rejects when the tenant window is exhausted', async () => {
    const consume = jest.fn(async () => ({ allowed: false, remainingPoints: 0, msBeforeNext: 1000, consumedPoints: 121 }))
    const container = makeContainer({ rateLimiterService: { consume } })
    const result = await enforceWebSearchRateLimit(container, { runId: 'r1', tenantId: 't1' }, baseConfig)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('tenant')
  })

  it('skips the per-run window when there is no run id', async () => {
    const consume = jest.fn(async () => ({ allowed: true, remainingPoints: 5, msBeforeNext: 0, consumedPoints: 1 }))
    const container = makeContainer({ rateLimiterService: { consume } })
    await enforceWebSearchRateLimit(container, { runId: null, tenantId: 't1' }, baseConfig)
    expect(consume).toHaveBeenCalledTimes(1)
  })
})
