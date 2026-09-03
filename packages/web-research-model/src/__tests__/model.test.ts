import { createTestContext, describeAdapterContract } from '@open-mercato/web-research/testing'
import { createModelAdapter, modelAdapterModule, type GenerateFn, type ModelResolver } from '../adapter'
import { parseModelSummaries, stripSummaryBlock } from '../parse'

const anthropicResolver: ModelResolver = () => ({
  model: { id: 'fake' },
  providerId: 'anthropic',
  modelId: 'claude-sonnet-5',
})

const REPLY = `Open Mercato is a modular commerce platform.

\`\`\`json
[
  {"url": "https://a.com/1", "title": "Alpha docs", "summary": "Explains the module system in detail."},
  {"url": "https://b.com/2", "title": "Beta post", "summary": "Covers pricing."}
]
\`\`\``

const generate =
  (result: Awaited<ReturnType<GenerateFn>>): GenerateFn =>
  async () =>
    result

/** Stands in for the provider SDK so these tests never load one. */
const loadTools = async () => ({ web_search: {} })

describe('parseModelSummaries', () => {
  it('reads a fenced JSON block', () => {
    expect(parseModelSummaries(REPLY)).toEqual([
      { url: 'https://a.com/1', title: 'Alpha docs', summary: 'Explains the module system in detail.' },
      { url: 'https://b.com/2', title: 'Beta post', summary: 'Covers pricing.' },
    ])
  })

  it('reads a bare array when the model skipped the fence', () => {
    expect(parseModelSummaries('Here you go: [{"url":"https://x/1","summary":"s"}]')).toEqual([
      { url: 'https://x/1', summary: 's' },
    ])
  })

  it('returns nothing for malformed or absent JSON', () => {
    expect(parseModelSummaries('no json here')).toEqual([])
    expect(parseModelSummaries('```json\n{ broken ]\n```')).toEqual([])
  })

  it('drops entries without a url', () => {
    expect(parseModelSummaries('[{"summary":"orphan"},{"url":"https://x/1"}]')).toEqual([
      { url: 'https://x/1' },
    ])
  })
})

describe('stripSummaryBlock', () => {
  it('keeps the prose and drops the machine-readable block', () => {
    expect(stripSummaryBlock(REPLY)).toBe('Open Mercato is a modular commerce platform.')
  })
})

describe('model adapter', () => {
  it('is unavailable when the host provided no resolver', async () => {
    const adapter = createModelAdapter({})
    expect(adapter.readiness().ready).toBe(false)
    await expect(adapter.search({ query: 'x', limit: 5 }, createTestContext())).resolves.toMatchObject({
      status: 'unavailable',
    })
  })

  it('attaches model summaries to the URLs the search tool returned', async () => {
    const adapter = createModelAdapter({
      resolveModel: anthropicResolver,
      loadTools,
      generate: generate({
        text: REPLY,
        sources: [
          { sourceType: 'url', url: 'https://a.com/1', title: 'Raw title' },
          { sourceType: 'url', url: 'https://b.com/2' },
        ],
      }),
    })

    const outcome = await adapter.search({ query: 'open mercato', limit: 5 }, createTestContext())

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    // The old implementation returned snippet: '' here, which is the whole reason
    // the agent had to spend a web_fetch per link to learn anything.
    expect(outcome.results).toEqual([
      { url: 'https://a.com/1', title: 'Alpha docs', snippet: 'Explains the module system in detail.' },
      { url: 'https://b.com/2', title: 'Beta post', snippet: 'Covers pricing.' },
    ])
    expect(outcome.answer).toBe('Open Mercato is a modular commerce platform.')
  })

  it('never introduces a URL the search tool did not return', async () => {
    const adapter = createModelAdapter({
      resolveModel: anthropicResolver,
      loadTools,
      generate: generate({
        text: '[{"url":"https://hallucinated.example/x","summary":"invented"}]',
        sources: [{ sourceType: 'url', url: 'https://real.com/1' }],
      }),
    })

    const outcome = await adapter.search({ query: 'x', limit: 5 }, createTestContext())

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.results.map((result) => result.url)).toEqual(['https://real.com/1'])
  })

  it('keeps a prose answer that cited nothing', async () => {
    const adapter = createModelAdapter({
      resolveModel: anthropicResolver,
      loadTools,
      generate: generate({ text: 'A plain answer with no citations.', sources: [] }),
    })

    const outcome = await adapter.search({ query: 'x', limit: 5 }, createTestContext())

    expect(outcome).toMatchObject({ status: 'ok', results: [], answer: 'A plain answer with no citations.' })
  })

  it('is empty when the model produced neither links nor prose', async () => {
    const adapter = createModelAdapter({
      resolveModel: anthropicResolver,
      loadTools,
      generate: generate({ text: '', sources: [] }),
    })

    await expect(adapter.search({ query: 'x', limit: 5 }, createTestContext())).resolves.toMatchObject({
      status: 'empty',
    })
  })

  it('reports a provider without native search as unavailable, not an error', async () => {
    const adapter = createModelAdapter({
      resolveModel: () => ({ model: {}, providerId: 'ollama', modelId: 'llama' }),
      loadTools: async () => null,
      generate: generate({ text: 'x', sources: [] }),
    })

    await expect(adapter.search({ query: 'x', limit: 5 }, createTestContext())).resolves.toMatchObject({
      status: 'unavailable',
    })
  })

  it('surfaces a resolver failure as unavailable', async () => {
    const adapter = createModelAdapter({
      resolveModel: () => {
        throw new Error('no API key in this process')
      },
    })

    await expect(adapter.search({ query: 'x', limit: 5 }, createTestContext())).resolves.toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('no API key in this process'),
    })
  })

  it('reports a spent quota as unavailable rather than a retriable error', async () => {
    // Seen live against OpenAI: reported as `error` with retriable: true, which
    // reads as bad luck when the fix is billing.
    const adapter = createModelAdapter({
      resolveModel: () => ({ model: {}, providerId: 'openai', modelId: 'gpt' }),
      loadTools: async () => ({ web_search: {} }),
      generate: async () => {
        throw new Error(
          'Failed after 3 attempts. Last error: AI_APICallError: You exceeded your current quota, please check your plan and billing details.',
        )
      },
    })

    await expect(adapter.search({ query: 'x', limit: 5 }, createTestContext())).resolves.toMatchObject({
      status: 'unavailable',
    })
  })

  it('still reports a genuine transient failure as a retriable error', async () => {
    const adapter = createModelAdapter({
      resolveModel: () => ({ model: {}, providerId: 'openai', modelId: 'gpt' }),
      loadTools: async () => ({ web_search: {} }),
      generate: async () => {
        throw new Error('socket hang up')
      },
    })

    await expect(adapter.search({ query: 'x', limit: 5 }, createTestContext())).resolves.toMatchObject({
      status: 'error',
      retriable: true,
    })
  })

  it('passes the abort signal down and reports a timeout when aborted', async () => {
    const controller = new AbortController()
    let received: AbortSignal | undefined
    const adapter = createModelAdapter({
      resolveModel: anthropicResolver,
      loadTools,
      generate: async (input) => {
        received = input.abortSignal
        controller.abort()
        throw new Error('aborted by test')
      },
    })

    const outcome = await adapter.search(
      { query: 'x', limit: 5 },
      createTestContext({ signal: controller.signal }),
    )

    expect(received).toBe(controller.signal)
    expect(outcome.status).toBe('timeout')
  })

  it('caps results at the requested limit', async () => {
    const adapter = createModelAdapter({
      resolveModel: anthropicResolver,
      loadTools,
      generate: generate({
        text: '',
        sources: Array.from({ length: 10 }, (_, index) => ({
          sourceType: 'url',
          url: `https://e.com/${index}`,
        })),
      }),
    })

    const outcome = await adapter.search({ query: 'x', limit: 3 }, createTestContext())

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.results).toHaveLength(3)
  })
})

describeAdapterContract(
  modelAdapterModule,
  {
    unconfiguredOptions: {},
    configuredOptions: {
      resolveModel: anthropicResolver,
      loadTools,
      generate: generate({ text: '', sources: [{ sourceType: 'url', url: 'https://e.com/1' }] }),
    },
  },
  { describe, it, expect: expect as never },
)
