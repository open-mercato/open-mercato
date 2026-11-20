import type { SearchAdapter } from '../../contract/adapter'
import type { FetchOutcome } from '../../contract/outcomes'
import { resolvePolicy } from '../../contract/policy'
import { createStubHttpClient } from '../../testing/contract'
import { createFakeAdapter } from '../../testing/fakeAdapter'
import { createSearchEngine } from '../engine'
import type { EngineAdapterEntry, SearchEngineOptions, SearchEngineResult } from '../types'

const ALLOWED_URL = 'https://allowed.test/start'
const FINAL_URL = 'https://allowed.test/final'
const DENIED_URL = 'http://search.internal.local/admin'
const PAGE_TEXT = 'A permitted page with useful readable content for the agent.'
const DENIED_TEXT = 'A synthetic marker from the denied internal page.'

const entry = (adapter: SearchAdapter): EngineAdapterEntry => ({
  adapter,
  enabled: true,
  order: 0,
  weight: 1,
})

const isContentUrlAllowed = (url: string): boolean => new URL(url).hostname === 'allowed.test'

function engineWith(overrides: Partial<SearchEngineOptions> = {}) {
  return createSearchEngine({
    policy: resolvePolicy({ minResults: 1, lastResort: null, escalateToBrowser: true }),
    adapters: [entry(createFakeAdapter({ id: 'search', results: [{ url: ALLOWED_URL }] }))],
    http: createStubHttpClient(() => ({ body: PAGE_TEXT, contentType: 'text/plain' })),
    isContentUrlAllowed,
    ...overrides,
  })
}

function browserWith(fetch: NonNullable<SearchAdapter['fetch']>): SearchAdapter {
  return {
    ...createFakeAdapter({ id: 'browser', kind: 'browser', capabilities: { fetch: true } }),
    fetch,
  }
}

describe('content URL authorization', () => {
  it('skips denied result URLs before page fetching or fetch-budget charges', async () => {
    const http = createStubHttpClient(() => ({ body: DENIED_TEXT }))
    const engine = engineWith({
      http,
      adapters: [entry(createFakeAdapter({ id: 'search', results: [{ url: DENIED_URL }] }))],
    })

    const result = await engine.search({ query: 'internal page', includeContent: true })

    expect(http.calls).toEqual([])
    expect(result.diagnostics.pagesRead).toBe(0)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].content).toBeNull()
  })

  it('blocks a direct denied URL before HTTP or browser navigation', async () => {
    const http = createStubHttpClient(() => ({ body: DENIED_TEXT }))
    const browserFetch = jest.fn(async (): Promise<FetchOutcome> => ({
      status: 'unavailable',
      reason: 'not expected',
    }))
    const engine = engineWith({ http, adapters: [entry(browserWith(browserFetch))] })

    await expect(engine.fetch({ url: DENIED_URL })).resolves.toMatchObject({
      status: 'blocked',
      code: 'domain_blocked',
    })
    await expect(engine.fetch({ url: DENIED_URL, render: 'always' })).resolves.toMatchObject({
      status: 'blocked',
      code: 'domain_blocked',
    })

    expect(http.calls).toEqual([])
    expect(browserFetch).not.toHaveBeenCalled()
  })

  it('passes per-hop authorization to HTTP and never escalates a domain denial', async () => {
    const browserFetch = jest.fn(async (): Promise<FetchOutcome> => ({
      status: 'unavailable',
      reason: 'not expected',
    }))
    const http = createStubHttpClient((_url, init) => {
      expect(init?.assertUrlAllowed).toBeDefined()
      init?.assertUrlAllowed?.(DENIED_URL)
      return { url: DENIED_URL, body: DENIED_TEXT }
    })
    const engine = engineWith({ http, adapters: [entry(browserWith(browserFetch))] })

    await expect(engine.fetch({ url: ALLOWED_URL })).resolves.toMatchObject({
      status: 'blocked',
      code: 'domain_blocked',
    })

    expect(browserFetch).not.toHaveBeenCalled()
  })

  it('rejects a denied final URL even when a custom HTTP client ignores the assertion', async () => {
    const http = createStubHttpClient(() => ({ url: DENIED_URL, body: DENIED_TEXT }))
    const engine = engineWith({ http })

    const result = await engine.search({ query: 'redirected page', includeContent: true })
    const fetched = await engine.fetch({ url: ALLOWED_URL, render: 'never' })

    expect(fetched).toMatchObject({ status: 'blocked', code: 'domain_blocked' })
    expect(result.results[0]).toMatchObject({ url: ALLOWED_URL, content: null })
    expect(JSON.stringify(result.results)).not.toContain(DENIED_TEXT)
  })

  it('attributes permitted redirected content to its final URL', async () => {
    const http = createStubHttpClient((_url, init) => {
      init?.assertUrlAllowed?.(FINAL_URL)
      return { url: FINAL_URL, body: PAGE_TEXT, contentType: 'text/plain' }
    })
    const engine = engineWith({ http })

    const result = await engine.search({ query: 'permitted redirect', includeContent: true })

    expect(result.results[0]).toMatchObject({ url: FINAL_URL, content: PAGE_TEXT })
    expect(result.diagnostics.pagesRead).toBe(1)
  })

  it('keeps adapter service requests independent of page-domain policy', async () => {
    const assertions: Array<boolean> = []
    const http = createStubHttpClient((url, init) => {
      assertions.push(init?.assertUrlAllowed !== undefined)
      return { body: url === DENIED_URL ? 'adapter API response' : PAGE_TEXT, contentType: 'text/plain' }
    })
    const adapter: SearchAdapter = {
      ...createFakeAdapter({ id: 'internal-adapter' }),
      async search(_request, context) {
        await context.http.request(DENIED_URL)
        return { status: 'ok', results: [{ url: ALLOWED_URL }] }
      },
    }
    const engine = engineWith({ http, adapters: [entry(adapter)] })

    const result = await engine.search({ query: 'permitted adapter', includeContent: true })

    expect(http.calls).toEqual([DENIED_URL, ALLOWED_URL])
    expect(assertions).toEqual([false, true])
    expect(result.results[0].content).toBe(PAGE_TEXT)
  })

  it.each(['auto', 'always'] as const)('refuses unguarded browser content navigation in %s mode', async (render) => {
    const http = createStubHttpClient(() => ({ body: '<html><body><div id="root"></div></body></html>' }))
    const browserFetch = jest.fn(async (): Promise<FetchOutcome> => ({
      status: 'unavailable',
      reason: 'not expected',
    }))
    const engine = engineWith({ http, adapters: [entry(browserWith(browserFetch))] })

    const outcome = await engine.fetch({ url: ALLOWED_URL, render })

    expect(browserFetch).not.toHaveBeenCalled()
    if (render === 'always') {
      expect(outcome.status).toBe('blocked')
      expect(http.calls).toEqual([])
    } else {
      expect(outcome).toMatchObject({ status: 'ok', page: { renderedWith: 'http' } })
    }
  })

  it('preserves browser content fetching when no URL policy is supplied', async () => {
    const browserFetch = jest.fn(async (): Promise<FetchOutcome> => ({
      status: 'ok',
      page: {
        url: FINAL_URL,
        title: null,
        text: PAGE_TEXT,
        contentType: 'text/html',
        status: 200,
        truncated: false,
        renderedWith: 'browser',
      },
    }))
    const engine = engineWith({
      adapters: [entry(browserWith(browserFetch))],
      isContentUrlAllowed: undefined,
    })

    await expect(engine.fetch({ url: ALLOWED_URL, render: 'always' })).resolves.toMatchObject({
      status: 'ok',
      page: { url: FINAL_URL, text: PAGE_TEXT, renderedWith: 'browser' },
    })
    expect(browserFetch).toHaveBeenCalledTimes(1)
  })

  it('bypasses cached enriched content whenever page-domain policy is supplied', async () => {
    const unsafe = await engineWith({
      http: createStubHttpClient(() => ({ body: DENIED_TEXT, contentType: 'text/plain' })),
      isContentUrlAllowed: undefined,
    }).search({ query: 'cached redirect', includeContent: true })
    const cache = {
      get: jest.fn(async (): Promise<SearchEngineResult | null> => unsafe),
      set: jest.fn(async () => {}),
    }
    const http = createStubHttpClient(() => ({ body: PAGE_TEXT, contentType: 'text/plain' }))
    const engine = engineWith({ http, cache })

    const first = await engine.search({ query: 'cached redirect', includeContent: true })
    const second = await engine.search({ query: 'cached redirect', includeContent: true })

    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(http.calls).toEqual([ALLOWED_URL, ALLOWED_URL])
    expect(first.results[0].content).toBe(PAGE_TEXT)
    expect(second.results[0].content).toBe(PAGE_TEXT)
    expect(first.diagnostics.cached).toBe(false)
    expect(second.diagnostics.cached).toBe(false)
  })
})
