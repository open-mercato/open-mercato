import { createStubHttpClient, createTestContext, describeAdapterContract } from '@open-mercato/web-research/testing'
import { createTavilyAdapter, tavilyAdapterModule } from '../adapter'

const BODY = JSON.stringify({
  answer: 'Open Mercato is a modular commerce platform.',
  results: [
    { url: 'https://a.com/1', title: 'Alpha', content: 'Alpha snippet', score: 0.9 },
    { url: 'https://b.com/2', title: 'Beta', content: 'Beta snippet', score: 0.5 },
  ],
})

describe('tavily adapter', () => {
  it('is unavailable without a key and makes no call', async () => {
    const http = createStubHttpClient(() => ({ body: BODY }))
    const outcome = await createTavilyAdapter({}).search({ query: 'x', limit: 5 }, createTestContext({ http }))
    expect(outcome).toMatchObject({ status: 'unavailable' })
    expect(http.calls).toHaveLength(0)
  })

  it('maps results and keeps the vendor answer', async () => {
    const http = createStubHttpClient(() => ({ body: BODY }))
    const outcome = await createTavilyAdapter({ apiKey: 'k' }).search(
      { query: 'x', limit: 5 },
      createTestContext({ http }),
    )
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.results[0]).toMatchObject({ url: 'https://a.com/1', snippet: 'Alpha snippet', score: 0.9 })
    expect(outcome.answer).toContain('modular commerce platform')
  })

  it('sends the key as a bearer token and honours the site filter', async () => {
    const seen: Array<{ headers?: Record<string, string>; body?: string }> = []
    const http = createStubHttpClient((_url, init) => {
      seen.push({ headers: init?.headers as Record<string, string>, body: init?.body })
      return { body: BODY }
    })
    await createTavilyAdapter({ apiKey: 'secret' }).search(
      { query: 'pricing', limit: 5, site: 'example.com' },
      createTestContext({ http }),
    )
    expect(seen[0].headers?.authorization).toBe('Bearer secret')
    expect(JSON.parse(seen[0].body ?? '{}').query).toBe('pricing site:example.com')
  })

  it('reports an unrecognized payload as an error', async () => {
    const http = createStubHttpClient(() => ({ body: '{"results":"nope"}' }))
    const outcome = await createTavilyAdapter({ apiKey: 'k' }).search(
      { query: 'x', limit: 5 },
      createTestContext({ http }),
    )
    expect(outcome).toMatchObject({ status: 'error' })
  })

  it('returns empty when the vendor found nothing and offered no answer', async () => {
    const http = createStubHttpClient(() => ({ body: JSON.stringify({ results: [] }) }))
    const outcome = await createTavilyAdapter({ apiKey: 'k' }).search(
      { query: 'x', limit: 5 },
      createTestContext({ http }),
    )
    expect(outcome.status).toBe('empty')
  })
})

describeAdapterContract(
  tavilyAdapterModule,
  {
    unconfiguredOptions: {},
    configuredOptions: { apiKey: 'test-key' },
    context: () => createTestContext({ http: createStubHttpClient(() => ({ body: BODY })) }),
  },
  { describe, it, expect: expect as never },
)
