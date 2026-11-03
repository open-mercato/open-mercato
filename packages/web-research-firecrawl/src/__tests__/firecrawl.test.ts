import { createStubHttpClient, createTestContext, describeAdapterContract } from '@open-mercato/web-research/testing'
import { createFirecrawlAdapter, firecrawlAdapterModule } from '../adapter'

const SEARCH_BODY = JSON.stringify({
  success: true,
  data: [
    {
      url: 'https://example.com/a',
      title: 'Alpha',
      description: 'Alpha snippet',
      markdown: '# Alpha\n\nBody text.',
      publishedDate: '2026-01-01',
    },
    { url: 'https://example.com/b', title: 'Beta', description: 'Beta snippet' },
  ],
})

describe('firecrawl adapter', () => {
  it('is unavailable without an API key and never calls out', async () => {
    const http = createStubHttpClient(() => ({ body: SEARCH_BODY }))
    const adapter = createFirecrawlAdapter({})

    const outcome = await adapter.search({ query: 'x', limit: 5 }, createTestContext({ http }))

    expect(outcome).toMatchObject({ status: 'unavailable' })
    expect(http.calls).toHaveLength(0)
  })

  it('maps search results including inline content', async () => {
    const http = createStubHttpClient(() => ({ body: SEARCH_BODY, contentType: 'application/json' }))
    const adapter = createFirecrawlAdapter({ apiKey: 'k' })

    const outcome = await adapter.search({ query: 'x', limit: 5 }, createTestContext({ http }))

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.results[0]).toEqual({
      url: 'https://example.com/a',
      title: 'Alpha',
      snippet: 'Alpha snippet',
      content: '# Alpha\n\nBody text.',
      publishedAt: '2026-01-01',
    })
    expect(outcome.results[1].content).toBeNull()
  })

  it('appends a site filter to the query', async () => {
    const bodies: string[] = []
    const http = createStubHttpClient((_url, init) => {
      bodies.push(String(init?.body ?? ''))
      return { body: SEARCH_BODY }
    })
    const adapter = createFirecrawlAdapter({ apiKey: 'k' })

    await adapter.search({ query: 'pricing', limit: 5, site: 'example.com' }, createTestContext({ http }))

    expect(JSON.parse(bodies[0]).query).toBe('pricing site:example.com')
  })

  it('reports an unrecognized payload as an error rather than crashing', async () => {
    const http = createStubHttpClient(() => ({ body: '{"unexpected":true,"data":"nope"}' }))
    const adapter = createFirecrawlAdapter({ apiKey: 'k' })

    const outcome = await adapter.search({ query: 'x', limit: 5 }, createTestContext({ http }))

    expect(outcome).toMatchObject({ status: 'error' })
  })

  it('returns empty rather than ok when the vendor found nothing', async () => {
    const http = createStubHttpClient(() => ({ body: JSON.stringify({ success: true, data: [] }) }))
    const adapter = createFirecrawlAdapter({ apiKey: 'k' })

    const outcome = await adapter.search({ query: 'x', limit: 5 }, createTestContext({ http }))

    expect(outcome.status).toBe('empty')
  })

  it('scrapes a page into readable text', async () => {
    const http = createStubHttpClient(() => ({
      body: JSON.stringify({
        success: true,
        data: {
          markdown: 'Rendered content',
          metadata: { title: 'Title', sourceURL: 'https://example.com/a', statusCode: 200 },
        },
      }),
    }))
    const adapter = createFirecrawlAdapter({ apiKey: 'k' })

    const outcome = await adapter.fetch?.({ url: 'https://example.com/a' }, createTestContext({ http }))

    expect(outcome).toMatchObject({
      status: 'ok',
      page: { title: 'Title', text: 'Rendered content', renderedWith: 'browser' },
    })
  })

  it('sends the API key as a bearer token', async () => {
    const seen: Array<Record<string, string> | undefined> = []
    const http = createStubHttpClient((_url, init) => {
      seen.push(init?.headers as Record<string, string> | undefined)
      return { body: SEARCH_BODY }
    })
    const adapter = createFirecrawlAdapter({ apiKey: 'secret-key' })

    await adapter.search({ query: 'x', limit: 5 }, createTestContext({ http }))

    expect(seen[0]?.authorization).toBe('Bearer secret-key')
  })
})

describeAdapterContract(
  firecrawlAdapterModule,
  {
    unconfiguredOptions: {},
    configuredOptions: { apiKey: 'test-key' },
    context: () => createTestContext({ http: createStubHttpClient(() => ({ body: SEARCH_BODY })) }),
  },
  { describe, it, expect: expect as never },
)
