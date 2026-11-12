import { createStubHttpClient, createTestContext, describeAdapterContract } from '@open-mercato/web-research/testing'
import { describeOptionsSchema } from '@open-mercato/web-research'
import { createExaAdapter, exaAdapterModule } from '../adapter'

const BODY = JSON.stringify({
  results: [
    {
      url: 'https://a.com/1',
      title: 'Alpha',
      highlights: ['first passage', 'second passage'],
      text: 'Full alpha page text',
      publishedDate: '2026-05-01T00:00:00.000Z',
      score: 0.9,
    },
    { url: 'https://b.com/2', title: 'Beta', summary: 'Beta summary' },
    { title: 'No url at all' },
  ],
  costDollars: { total: 0.007 },
})

type SentRequest = { headers?: Record<string, string>; body?: Record<string, unknown> }

function recordingClient(body = BODY) {
  const sent: SentRequest[] = []
  const http = createStubHttpClient((_url, init) => {
    sent.push({
      headers: init?.headers as Record<string, string>,
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    })
    return { body }
  })
  return { http, sent }
}

describe('exa adapter', () => {
  it('is unavailable without a key and makes no call', async () => {
    const { http } = recordingClient()
    const outcome = await createExaAdapter({}).search({ query: 'x', limit: 5 }, createTestContext({ http }))
    expect(outcome).toMatchObject({ status: 'unavailable' })
    expect(http.calls).toHaveLength(0)
  })

  it('maps results and prefers highlights as the snippet', async () => {
    // Highlights are the passages Exa judged relevant; the head of the page text
    // is what every other source already gives us.
    const { http } = recordingClient()
    const outcome = await createExaAdapter({ apiKey: 'k' }).search(
      { query: 'x', limit: 5 },
      createTestContext({ http }),
    )
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.results[0]).toMatchObject({
      url: 'https://a.com/1',
      snippet: 'first passage … second passage',
      publishedAt: '2026-05-01T00:00:00.000Z',
      score: 0.9,
    })
    expect(outcome.results[1]?.snippet).toBe('Beta summary')
  })

  it('drops a result with no url rather than emitting a broken citation', async () => {
    const { http } = recordingClient()
    const outcome = await createExaAdapter({ apiKey: 'k' }).search(
      { query: 'x', limit: 10 },
      createTestContext({ http }),
    )
    if (outcome.status !== 'ok') throw new Error('expected ok')
    expect(outcome.results).toHaveLength(2)
  })

  it('sends the key in x-api-key and respects the limit', async () => {
    const { http, sent } = recordingClient()
    await createExaAdapter({ apiKey: 'secret' }).search({ query: 'q', limit: 3 }, createTestContext({ http }))
    expect(sent[0]?.headers?.['x-api-key']).toBe('secret')
    expect(sent[0]?.body?.numResults).toBe(3)
  })

  it('filters by domain natively instead of folding site: into the query', async () => {
    // The index is embeddings-based, so an operator directive inside the query
    // text competes with the semantics rather than constraining them.
    const { http, sent } = recordingClient()
    await createExaAdapter({ apiKey: 'k' }).search(
      { query: 'pricing', limit: 5, site: 'example.com' },
      createTestContext({ http }),
    )
    expect(sent[0]?.body?.includeDomains).toEqual(['example.com'])
    expect(sent[0]?.body?.query).toBe('pricing')
  })

  it('turns a freshness window into a published-after bound', async () => {
    const { http, sent } = recordingClient()
    await createExaAdapter({ apiKey: 'k' }).search(
      { query: 'q', limit: 5, freshness: 'week' },
      createTestContext({ http }),
    )
    const bound = Date.parse(sent[0]?.body?.startPublishedDate as string)
    const ageDays = (Date.now() - bound) / 86_400_000
    expect(ageDays).toBeGreaterThan(6.5)
    expect(ageDays).toBeLessThan(7.5)
  })

  it('asks for page text only when content is enabled', async () => {
    const { http: lean, sent: leanSent } = recordingClient()
    await createExaAdapter({ apiKey: 'k' }).search({ query: 'q', limit: 5 }, createTestContext({ http: lean }))
    expect((leanSent[0]?.body?.contents as Record<string, unknown>).text).toBeUndefined()

    const { http: full, sent: fullSent } = recordingClient()
    const adapter = createExaAdapter({ apiKey: 'k', includeContent: true, maxCharacters: 1234 })
    const outcome = await adapter.search({ query: 'q', limit: 5 }, createTestContext({ http: full }))
    expect((fullSent[0]?.body?.contents as Record<string, { maxCharacters: number }>).text.maxCharacters).toBe(1234)
    expect(adapter.capabilities.content).toBe(true)
    if (outcome.status !== 'ok') throw new Error('expected ok')
    expect(outcome.results[0]?.content).toBe('Full alpha page text')
  })

  it('reports a malformed payload as an error rather than crashing', async () => {
    const http = createStubHttpClient(() => ({ body: 'not json at all' }))
    const outcome = await createExaAdapter({ apiKey: 'k' }).search(
      { query: 'q', limit: 5 },
      createTestContext({ http }),
    )
    expect(outcome).toMatchObject({ status: 'error', retriable: false })
  })

  it('answers a health check without spending a search', async () => {
    // This runs for every installed adapter whenever the settings page is opened,
    // and Exa bills per call.
    const { http } = recordingClient()
    const health = await createExaAdapter({ apiKey: 'k' }).healthCheck?.(createTestContext({ http }))
    expect(health?.ok).toBe(true)
    expect(http.calls).toHaveLength(0)
  })

  it('names its credential so the settings form masks it', async () => {
    const apiKeyField = describeOptionsSchema(exaAdapterModule).find((field) => field.name === 'apiKey')
    expect(apiKeyField?.secret).toBe(true)
  })
})

describeAdapterContract(
  exaAdapterModule,
  {
    unconfiguredOptions: {},
    configuredOptions: { apiKey: 'test-key' },
    context: () => createTestContext({ http: createStubHttpClient(() => ({ body: BODY })) }),
  },
  { describe, it, expect: expect as never },
)
