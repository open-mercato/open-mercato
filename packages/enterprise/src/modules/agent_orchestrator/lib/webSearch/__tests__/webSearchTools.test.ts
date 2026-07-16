import type { AwilixContainer } from 'awilix'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { WebSearchProviderError, type WebSearchProvider } from '@open-mercato/web-search'
import {
  webFetchTool,
  webSearchTool,
  WEB_FETCH_TOOL_ID,
  WEB_SEARCH_TOOL_ID,
} from '../webSearchTools'

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

function makeCtx(container: AwilixContainer): McpToolContext {
  return {
    tenantId: 't1',
    organizationId: 'o1',
    userId: 'u1',
    container,
    userFeatures: ['agent_orchestrator.web_search'],
    isSuperAdmin: false,
  } as McpToolContext
}

function stubProvider(overrides: Partial<WebSearchProvider> = {}): WebSearchProvider {
  return {
    id: 'stub',
    search: jest.fn(async () => [{ title: 'A', url: 'https://a.example', snippet: 'snippet a' }]),
    fetch: jest.fn(async () => ({ url: 'https://a.example', text: 'body text', truncated: false })),
    healthCheck: jest.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

const originalEnv = { ...process.env }
afterEach(() => {
  process.env = { ...originalEnv }
})

describe('web_search tool', () => {
  it('is declared read-only and gated by the web_search feature', () => {
    expect(webSearchTool.name).toBe(WEB_SEARCH_TOOL_ID)
    expect(webSearchTool.isMutation).toBe(false)
    expect(webSearchTool.requiredFeatures).toEqual(['agent_orchestrator.web_search'])
  })

  it('returns provider results on the happy path', async () => {
    const provider = stubProvider()
    const ctx = makeCtx(makeContainer({ webSearchProvider: provider }))
    const result = (await webSearchTool.handler({ query: 'deal news' }, ctx)) as { ok: boolean; results: unknown[] }
    expect(result.ok).toBe(true)
    expect(result.results).toHaveLength(1)
    expect(provider.search).toHaveBeenCalledWith('deal news', expect.objectContaining({ limit: 10 }))
  })

  it('filters out results whose domain is denied', async () => {
    process.env.OM_AGENT_WEB_SEARCH_DENY_DOMAINS = 'a.example'
    const provider = stubProvider({
      search: jest.fn(async () => [
        { title: 'A', url: 'https://a.example/1', snippet: 's' },
        { title: 'B', url: 'https://b.example/2', snippet: 's' },
      ]),
    })
    const ctx = makeCtx(makeContainer({ webSearchProvider: provider }))
    const result = (await webSearchTool.handler({ query: 'q' }, ctx)) as { ok: boolean; results: Array<{ url: string }> }
    expect(result.ok).toBe(true)
    expect(result.results.map((r) => r.url)).toEqual(['https://b.example/2'])
  })

  it('returns not_configured when no provider is registered', async () => {
    const ctx = makeCtx(makeContainer({ webSearchProvider: null }))
    const result = (await webSearchTool.handler({ query: 'q' }, ctx)) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('not_configured')
  })

  it('maps a provider error to error data (never throws)', async () => {
    const provider = stubProvider({
      search: jest.fn(async () => {
        throw new WebSearchProviderError('bad_response', 'searxng down')
      }),
    })
    const ctx = makeCtx(makeContainer({ webSearchProvider: provider }))
    const result = (await webSearchTool.handler({ query: 'q' }, ctx)) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('bad_response')
  })

  it('returns rate_limited when the limiter rejects', async () => {
    const provider = stubProvider()
    const consume = jest.fn(async () => ({ allowed: false, remainingPoints: 0, msBeforeNext: 1000, consumedPoints: 999 }))
    const ctx = makeCtx(makeContainer({ webSearchProvider: provider, rateLimiterService: { consume } }))
    const result = (await webSearchTool.handler({ query: 'q' }, ctx)) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('rate_limited')
    expect(provider.search).not.toHaveBeenCalled()
  })
})

describe('web_fetch tool', () => {
  // web_fetch is provider-INDEPENDENT (uses the shared fetchUrl directly), so it
  // works with an empty container. A literal-IP URL exercises the path without DNS.
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('is declared read-only and gated by the web_search feature', () => {
    expect(webFetchTool.name).toBe(WEB_FETCH_TOOL_ID)
    expect(webFetchTool.isMutation).toBe(false)
    expect(webFetchTool.requiredFeatures).toEqual(['agent_orchestrator.web_search'])
  })

  it('returns readable text on the happy path (no search provider needed)', async () => {
    global.fetch = jest.fn(async () => new Response('<title>T</title><p>hello</p>', { status: 200 })) as unknown as typeof fetch
    const ctx = makeCtx(makeContainer({}))
    const result = (await webFetchTool.handler({ url: 'http://93.184.216.34/doc' }, ctx)) as {
      ok: boolean
      text: string
    }
    expect(result.ok).toBe(true)
    expect(result.text).toBe('hello')
  })

  it('blocks a denied domain before any egress', async () => {
    process.env.OM_AGENT_WEB_SEARCH_DENY_DOMAINS = '93.184.216.34'
    global.fetch = jest.fn() as unknown as typeof fetch
    const ctx = makeCtx(makeContainer({}))
    const result = (await webFetchTool.handler({ url: 'http://93.184.216.34/x' }, ctx)) as {
      ok: boolean
      code: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('domain_blocked')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('blocks a private/SSRF target (literal IP, no network)', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    const ctx = makeCtx(makeContainer({}))
    const result = (await webFetchTool.handler({ url: 'http://127.0.0.1/x' }, ctx)) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ssrf_blocked')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
