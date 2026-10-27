import { createStubHttpClient, createTestContext, describeAdapterContract } from '@open-mercato/web-research/testing'
import { createSearxngAdapter, searxngAdapterModule } from '../adapter'

const BODY = JSON.stringify({
  results: [
    { url: 'https://a.com/1', title: 'Alpha', content: 'Alpha snippet', score: 3.2 },
    { title: 'No url here', content: 'skipped' },
    { url: 'https://b.com/2', title: 'Beta', content: 'Beta snippet' },
  ],
})

const BASE = { baseUrl: 'https://searx.internal' }

describe('searxng adapter', () => {
  it('is unavailable without a base URL and makes no call', async () => {
    const http = createStubHttpClient(() => ({ body: BODY }))
    const outcome = await createSearxngAdapter({}).search({ query: 'x', limit: 5 }, createTestContext({ http }))
    expect(outcome).toMatchObject({ status: 'unavailable' })
    expect(http.calls).toHaveLength(0)
  })

  it('maps results and skips entries without a url', async () => {
    const http = createStubHttpClient(() => ({ body: BODY }))
    const outcome = await createSearxngAdapter(BASE).search(
      { query: 'x', limit: 5 },
      createTestContext({ http }),
    )
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.results.map((result) => result.url)).toEqual(['https://a.com/1', 'https://b.com/2'])
  })

  it('asks for JSON and passes engines, language and freshness through', async () => {
    const http = createStubHttpClient(() => ({ body: BODY }))
    await createSearxngAdapter({ ...BASE, engines: ['duckduckgo', 'brave'], language: 'en' }).search(
      { query: 'pricing', limit: 5, site: 'example.com', freshness: 'week' },
      createTestContext({ http }),
    )
    const requested = decodeURIComponent(http.calls[0])
    expect(requested).toContain('format=json')
    expect(requested).toContain('engines=duckduckgo,brave')
    expect(requested).toContain('language=en')
    expect(requested).toContain('time_range=week')
    expect(requested).toContain('site:example.com')
  })

  it('explains an unparseable payload as a likely JSON-format problem', async () => {
    const http = createStubHttpClient(() => ({ body: '<html>not json</html>' }))
    const outcome = await createSearxngAdapter(BASE).search(
      { query: 'x', limit: 5 },
      createTestContext({ http }),
    )
    expect(outcome).toMatchObject({ status: 'error' })
    if (outcome.status === 'error') expect(outcome.reason).toContain('JSON format')
  })

  it('respects the requested limit', async () => {
    const http = createStubHttpClient(() => ({ body: BODY }))
    const outcome = await createSearxngAdapter(BASE).search(
      { query: 'x', limit: 1 },
      createTestContext({ http }),
    )
    expect(outcome.status === 'ok' && outcome.results).toHaveLength(1)
  })
})

describeAdapterContract(
  searxngAdapterModule,
  {
    unconfiguredOptions: {},
    configuredOptions: BASE,
    context: () => createTestContext({ http: createStubHttpClient(() => ({ body: BODY })) }),
  },
  { describe, it, expect: expect as never },
)
