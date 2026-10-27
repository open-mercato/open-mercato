import type { AdapterCapabilities, ProbeCost, SearchAdapter } from '../../contract/adapter'
import type { FetchOutcome } from '../../contract/outcomes'
import { resolvePolicy, type SearchPolicyInput } from '../../contract/policy'
import type { RawResult } from '../../contract/results'
import type { SearchStep } from '../../contract/steps'
import { createStubHttpClient } from '../../testing/contract'
import { createFakeAdapter } from '../../testing/fakeAdapter'
import { createSearchEngine } from '../engine'
import type { EngineAdapterEntry, SearchEngineResult } from '../types'

const http = createStubHttpClient(() => ({ body: '<html><body><p>stub</p></body></html>' }))

/**
 * Matches on the host rather than a URL substring: `includes()` would also
 * match a host that merely embeds the name, which is both a weaker assertion
 * and a CodeQL finding.
 */
const hostOf = (url: string): string => new URL(url).hostname

const hits = (host: string, count: number): RawResult[] =>
  Array.from({ length: count }, (_, index) => ({
    url: `https://${host}/${index}`,
    title: `${host} ${index}`,
    snippet: 'snippet',
  }))

const entry = (adapter: SearchAdapter, overrides: Partial<EngineAdapterEntry> = {}): EngineAdapterEntry => ({
  adapter,
  weight: 1,
  order: 0,
  enabled: true,
  ...overrides,
})

const engineWith = (
  adapters: readonly EngineAdapterEntry[],
  policy: SearchPolicyInput = {},
  extra: { onStep?: (step: SearchStep) => void } = {},
) =>
  createSearchEngine({
    policy: resolvePolicy({ minResults: 3, ...policy }),
    adapters,
    http,
    ...(extra.onStep ? { onStep: extra.onStep } : {}),
  })

const statusOf = (result: SearchEngineResult, id: string): string | undefined =>
  result.diagnostics.adapters.find((diagnostic) => diagnostic.id === id)?.status

describe('search engine scheduling', () => {
  it('race mode answers from the first adapter and cancels the rest', async () => {
    const engine = engineWith(
      [
        entry(createFakeAdapter({ id: 'fast', latencyMs: 5, results: hits('fast.com', 3) }), { order: 0 }),
        entry(createFakeAdapter({ id: 'slow', latencyMs: 400, results: hits('slow.com', 3) }), { order: 1 }),
      ],
      { settleMode: 'race', concurrency: 2, minResults: 3 },
    )

    const result = await engine.search({ query: 'x' })

    expect(result.results.every((hit) => hostOf(hit.url) === 'fast.com')).toBe(true)
    expect(statusOf(result, 'slow')).toBe('cancelled')
  })

  it('quorum mode waits for a second adapter that a single-adapter quorum would have cancelled', async () => {
    const adapters = () => [
      entry(createFakeAdapter({ id: 'alpha', latencyMs: 5, results: hits('alpha.com', 3) }), { order: 0 }),
      entry(createFakeAdapter({ id: 'beta', latencyMs: 300, results: hits('beta.com', 3) }), { order: 1 }),
    ]
    const base = { settleMode: 'quorum' as const, concurrency: 2, minResults: 3, softDeadlineMs: 2_000 }

    const strict = await engineWith(adapters(), { ...base, minAdapters: 2 }).search({ query: 'x', limit: 10 })
    const lenient = await engineWith(adapters(), { ...base, minAdapters: 1 }).search({ query: 'x', limit: 10 })

    expect(statusOf(strict, 'beta')).toBe('ok')
    expect(statusOf(lenient, 'beta')).toBe('cancelled')
  })

  it('exhaustive mode runs every adapter even once satisfied', async () => {
    const engine = engineWith(
      [
        entry(createFakeAdapter({ id: 'alpha', results: hits('alpha.com', 5) }), { order: 0 }),
        entry(createFakeAdapter({ id: 'beta', latencyMs: 15, results: hits('beta.com', 5) }), { order: 1 }),
      ],
      { settleMode: 'exhaustive', concurrency: 1, minResults: 1 },
    )

    const result = await engine.search({ query: 'x', limit: 20 })

    expect(statusOf(result, 'alpha')).toBe('ok')
    expect(statusOf(result, 'beta')).toBe('ok')
  })

  it('skips an unconfigured adapter and says why', async () => {
    const engine = engineWith([
      entry(createFakeAdapter({ id: 'keyed', ready: 'API key is not set' })),
      entry(createFakeAdapter({ id: 'free', results: hits('free.com', 3) }), { order: 1 }),
    ])

    const result = await engine.search({ query: 'x' })

    const skipped = result.diagnostics.adapters.find((diagnostic) => diagnostic.id === 'keyed')
    expect(skipped?.status).toBe('skipped')
    expect(skipped?.reason).toBe('API key is not set')
    expect(result.results).not.toHaveLength(0)
  })

  it('contains an adapter that throws instead of returning an outcome', async () => {
    const engine = engineWith([
      entry(createFakeAdapter({ id: 'broken', throws: true }), { order: 0 }),
      entry(createFakeAdapter({ id: 'healthy', results: hits('healthy.com', 3) }), { order: 1 }),
    ])

    const result = await engine.search({ query: 'x' })

    expect(statusOf(result, 'broken')).toBe('error')
    expect(result.results.length).toBe(3)
  })

  it('runs the last-resort adapter even when it is disabled', async () => {
    const engine = engineWith(
      [
        entry(createFakeAdapter({ id: 'serp', outcome: { status: 'empty' } }), { order: 0 }),
        entry(createFakeAdapter({ id: 'model-native', results: hits('model.com', 3) }), {
          order: 1,
          enabled: false,
        }),
      ],
      { lastResort: 'model-native', minResults: 3 },
    )

    const result = await engine.search({ query: 'x' })

    expect(statusOf(result, 'model-native')).toBe('ok')
    expect(result.results.length).toBe(3)
  })

  it('does not invoke the last resort when the waves already satisfied the request', async () => {
    const lastResort = createFakeAdapter({ id: 'model-native', results: hits('model.com', 3) })
    const spy = jest.spyOn(lastResort, 'search')
    const engine = engineWith(
      [
        entry(createFakeAdapter({ id: 'serp', results: hits('serp.com', 5) }), { order: 0 }),
        entry(lastResort, { order: 1, enabled: false }),
      ],
      { lastResort: 'model-native', minResults: 3 },
    )

    await engine.search({ query: 'x' })

    expect(spy).not.toHaveBeenCalled()
  })

  it('escalates to a browser adapter when a SERP adapter is blocked', async () => {
    const engine = engineWith(
      [
        entry(
          createFakeAdapter({
            id: 'serp-html',
            kind: 'serp',
            outcome: { status: 'blocked', reason: 'HTTP 429' },
          }),
          { order: 0 },
        ),
        entry(
          createFakeAdapter({ id: 'browser-serp', kind: 'browser', results: hits('browser.com', 3) }),
          { order: 1 },
        ),
      ],
      { escalateToBrowser: true, minResults: 3, lastResort: null },
    )

    const result = await engine.search({ query: 'x' })

    expect(result.diagnostics.escalated).toBe(true)
    expect(statusOf(result, 'browser-serp')).toBe('ok')
    expect(result.results.length).toBe(3)
  })

  it('does not escalate when the wave already produced enough results', async () => {
    const browser = createFakeAdapter({ id: 'browser-serp', kind: 'browser', results: hits('b.com', 3) })
    const spy = jest.spyOn(browser, 'search')
    const engine = engineWith(
      [
        entry(createFakeAdapter({ id: 'serp-html', kind: 'serp', results: hits('serp.com', 5) }), {
          order: 0,
        }),
        entry(browser, { order: 1 }),
      ],
      { escalateToBrowser: true, minResults: 3 },
    )

    await engine.search({ query: 'x' })

    expect(spy).not.toHaveBeenCalled()
  })

  it('does not escalate to a browser adapter the operator disabled', async () => {
    const browser = createFakeAdapter({ id: 'browser-serp', kind: 'browser', results: hits('b.com', 3) })
    const spy = jest.spyOn(browser, 'search')
    const engine = engineWith(
      [
        entry(
          createFakeAdapter({
            id: 'serp-html',
            kind: 'serp',
            outcome: { status: 'blocked', reason: 'HTTP 429' },
          }),
          { order: 0 },
        ),
        entry(browser, { order: 1, enabled: false }),
      ],
      { escalateToBrowser: true, minResults: 3, lastResort: null },
    )

    const result = await engine.search({ query: 'x' })

    expect(spy).not.toHaveBeenCalled()
    expect(result.diagnostics.escalated).toBe(false)
  })

  it('does not escalate a fetch to a browser adapter the operator disabled', async () => {
    // An empty client-side render root is what classifies as `js-shell` and asks
    // for a browser render; without it there is nothing to escalate.
    const shell = createStubHttpClient(() => ({ body: '<html><body><div id="root"></div></body></html>' }))
    const browser = createFakeAdapter({ id: 'browser-fetch', kind: 'browser' })
    const fetchSpy = jest.fn(async () => ({ status: 'unavailable' as const, reason: 'unused' }))
    const engine = createSearchEngine({
      policy: resolvePolicy({ escalateToBrowser: true }),
      adapters: [entry({ ...browser, fetch: fetchSpy }, { enabled: false })],
      http: shell,
    })

    await engine.fetch({ url: 'https://example.com/app' })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('bounds a browser fetch that ignores its abort signal instead of hanging', async () => {
    const browser = createFakeAdapter({ id: 'wedged-browser', kind: 'browser', capabilities: { fetch: true } })
    // A browser adapter whose render neither honours the abort signal nor ever
    // settles — the wedged-Playwright case behind the 66-minute run hang.
    const neverSettles: SearchAdapter['fetch'] = () => new Promise<FetchOutcome>(() => {})
    const engine = createSearchEngine({
      policy: resolvePolicy({ escalateToBrowser: true, hardDeadlineMs: 500 }),
      adapters: [entry({ ...browser, fetch: neverSettles }, { order: 0 })],
      http,
    })

    const outcome = await engine.fetch({ url: 'https://example.com/app', render: 'always' })

    expect(outcome.status).toBe('timeout')
  })

  it('a wedged browser escalation during content enrichment does not hang the search', async () => {
    // A client-side-render shell classifies as `js-shell` and asks for a browser
    // render, so enrichment escalates the top result into the wedged adapter.
    const shell = createStubHttpClient(() => ({ body: '<html><body><div id="root"></div></body></html>' }))
    const browser = createFakeAdapter({ id: 'wedged-browser', kind: 'browser', capabilities: { fetch: true } })
    const neverSettles: SearchAdapter['fetch'] = () => new Promise<FetchOutcome>(() => {})
    const engine = createSearchEngine({
      policy: resolvePolicy({ escalateToBrowser: true, hardDeadlineMs: 500, minResults: 1, lastResort: null }),
      adapters: [
        entry(createFakeAdapter({ id: 'api', results: hits('example.com', 3) }), { order: 0 }),
        entry({ ...browser, fetch: neverSettles }, { order: 1 }),
      ],
      http: shell,
    })

    const result = await engine.search({ query: 'x', includeContent: true })

    // The search still returns its results rather than blocking on the escalation.
    expect(result.results.length).toBeGreaterThan(0)
  })

  it('gives an adapter its own timeout when the policy sets one', async () => {
    const adapters = () => [
      entry(createFakeAdapter({ id: 'slow', latencyMs: 200, results: hits('slow.com', 3) }), {
        timeoutMs: 5_000,
      }),
    ]

    const shared = await engineWith(
      [entry(createFakeAdapter({ id: 'slow', latencyMs: 200, results: hits('slow.com', 3) }))],
      { adapterTimeoutMs: 50, minResults: 1, lastResort: null },
    ).search({ query: 'x' })
    const overridden = await engineWith(adapters(), {
      adapterTimeoutMs: 50,
      minResults: 1,
      lastResort: null,
    }).search({ query: 'x' })

    expect(statusOf(shared, 'slow')).toBe('timeout')
    expect(statusOf(overridden, 'slow')).toBe('ok')
  })

  it('does not call a thin but healthy run degraded', async () => {
    const engine = engineWith(
      [entry(createFakeAdapter({ id: 'alpha', results: hits('alpha.com', 2) }))],
      { minResults: 5, lastResort: null },
    )

    const result = await engine.search({ query: 'x' })

    // Two hits under a minimum of five is the web being thin, not the engine
    // failing; an agent told otherwise reports its own findings as unreliable.
    expect(result.results.length).toBe(2)
    expect(result.diagnostics.degraded).toBe(false)
  })

  it('calls a run degraded when a source was lost', async () => {
    const engine = engineWith(
      [
        entry(createFakeAdapter({ id: 'alpha', results: hits('alpha.com', 2) })),
        entry(createFakeAdapter({ id: 'beta', outcome: { status: 'blocked', reason: 'HTTP 429' } }), {
          order: 1,
        }),
      ],
      { settleMode: 'exhaustive', minResults: 1, lastResort: null },
    )

    const result = await engine.search({ query: 'x' })

    expect(result.diagnostics.degraded).toBe(true)
  })

  it('omits the per-adapter view unless the caller asks for it', async () => {
    const engine = engineWith([entry(createFakeAdapter({ id: 'alpha', results: hits('alpha.com', 3) }))], {
      minResults: 1,
      lastResort: null,
    })

    expect((await engine.search({ query: 'x' })).byAdapter).toBeUndefined()
  })

  it('returns each adapter untouched by fusion when asked to compare', async () => {
    const alpha = createFakeAdapter({
      id: 'alpha',
      outcome: { status: 'ok', results: hits('shared.com', 1), answer: 'alpha prose' },
    })
    const beta = createFakeAdapter({
      id: 'beta',
      outcome: { status: 'ok', results: hits('shared.com', 1), answer: 'beta prose' },
    })
    const engine = engineWith([entry(alpha), entry(beta, { order: 1 })], {
      settleMode: 'exhaustive',
      minResults: 1,
      lastResort: null,
    })

    const result = await engine.search({ query: 'x' }, { includeAdapterResults: true })

    // Fusion collapses the shared hit into one and keeps only the first prose;
    // the comparison view is what survives that, per adapter.
    expect(result.results).toHaveLength(1)
    expect(result.answer).toBe('alpha prose')
    expect(result.byAdapter?.map((entry) => entry.adapterId)).toEqual(['alpha', 'beta'])
    expect(result.byAdapter?.map((entry) => entry.answer)).toEqual(['alpha prose', 'beta prose'])
    expect(result.byAdapter?.every((entry) => entry.results.length === 1)).toBe(true)
  })

  it('reports a degraded run rather than failing when every adapter is down', async () => {
    const engine = engineWith(
      [
        entry(createFakeAdapter({ id: 'a', outcome: { status: 'unavailable', reason: 'no key' } })),
        entry(createFakeAdapter({ id: 'b', outcome: { status: 'error', reason: 'boom', retriable: true } }), {
          order: 1,
        }),
      ],
      { lastResort: null },
    )

    const result = await engine.search({ query: 'x' })

    expect(result.results).toEqual([])
    expect(result.diagnostics.degraded).toBe(true)
    expect(result.diagnostics.adapters.map((diagnostic) => diagnostic.status).sort()).toEqual([
      'error',
      'unavailable',
    ])
  })

  it('surfaces an adapter answer without inventing one', async () => {
    const withAnswer = engineWith([
      entry(
        createFakeAdapter({
          id: 'model-native',
          outcome: { status: 'ok', results: hits('m.com', 2), answer: 'Because of X.' },
        }),
      ),
    ])
    expect((await withAnswer.search({ query: 'x' })).answer).toBe('Because of X.')

    const withoutAnswer = engineWith([entry(createFakeAdapter({ id: 'serp', results: hits('s.com', 2) }))])
    expect((await withoutAnswer.search({ query: 'x' })).answer).toBeNull()
  })

  it('stops waiting at the hard deadline', async () => {
    const engine = engineWith(
      [entry(createFakeAdapter({ id: 'stuck', latencyMs: 5_000, results: hits('stuck.com', 3) }))],
      { hardDeadlineMs: 500, softDeadlineMs: 100, adapterTimeoutMs: 500, lastResort: null },
    )

    const startedAt = Date.now()
    const result = await engine.search({ query: 'x' })

    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(result.results).toEqual([])
  })
})

describe('search engine narration', () => {
  it('emits an ordered step stream naming each adapter and outcome', async () => {
    const steps: SearchStep[] = []
    const engine = engineWith(
      [
        entry(createFakeAdapter({ id: 'alpha', results: hits('alpha.com', 3) }), { order: 0 }),
        entry(createFakeAdapter({ id: 'beta', ready: 'not configured' }), { order: 1 }),
      ],
      {},
      { onStep: (step) => steps.push(step) },
    )

    await engine.search({ query: 'x' })

    expect(steps.map((step) => step.seq)).toEqual(steps.map((_, index) => index))
    expect(steps.some((step) => step.adapterId === 'alpha' && step.event === 'ok')).toBe(true)
    expect(steps.some((step) => step.adapterId === 'beta' && step.event === 'unavailable')).toBe(true)
    expect(steps.at(-1)).toMatchObject({ phase: 'done', event: 'completed' })
  })

  it('keeps running when a step sink throws', async () => {
    const engine = engineWith(
      [entry(createFakeAdapter({ id: 'alpha', results: hits('alpha.com', 3) }))],
      {},
      {
        onStep: () => {
          throw new Error('sink exploded')
        },
      },
    )

    await expect(engine.search({ query: 'x' })).resolves.toMatchObject({
      results: expect.any(Array),
    })
  })
})

describe('search engine caching', () => {
  it('collapses concurrent identical queries onto one adapter call', async () => {
    const adapter = createFakeAdapter({ id: 'alpha', latencyMs: 20, results: hits('alpha.com', 3) })
    const spy = jest.spyOn(adapter, 'search')
    const engine = engineWith([entry(adapter)])

    await Promise.all([engine.search({ query: 'same' }), engine.search({ query: 'same' })])

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('serves a cached result and marks it as cached', async () => {
    const store = new Map<string, SearchEngineResult>()
    const cache = {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: SearchEngineResult) => {
        store.set(key, value)
      },
    }
    const adapter = createFakeAdapter({ id: 'alpha', results: hits('alpha.com', 3) })
    const spy = jest.spyOn(adapter, 'search')
    const engine = createSearchEngine({
      policy: resolvePolicy({ minResults: 3 }),
      adapters: [entry(adapter)],
      http,
      cache,
    })

    const first = await engine.search({ query: 'cached' })
    const second = await engine.search({ query: 'cached' })

    expect(first.diagnostics.cached).toBe(false)
    expect(second.diagnostics.cached).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('falls back to a live search when the cache throws', async () => {
    const cache = {
      get: async () => {
        throw new Error('cache down')
      },
      set: async () => {
        throw new Error('cache down')
      },
    }
    const engine = createSearchEngine({
      policy: resolvePolicy({ minResults: 3 }),
      adapters: [entry(createFakeAdapter({ id: 'alpha', results: hits('alpha.com', 3) }))],
      http,
      cache,
    })

    await expect(engine.search({ query: 'x' })).resolves.toMatchObject({ answer: null })
  })
})

describe('search engine health', () => {
  /** A fake that records every probe, so "was it called" is asserted on a counter. */
  const probeAdapter = (
    id: string,
    calls: string[],
    overrides: { probeCost?: ProbeCost; cost?: AdapterCapabilities['cost'] } = {},
  ): SearchAdapter => ({
    ...createFakeAdapter({
      id,
      results: hits(`${id}.com`, 1),
      ...(overrides.cost ? { capabilities: { cost: overrides.cost } } : {}),
    }),
    ...(overrides.probeCost ? { probeCost: overrides.probeCost } : {}),
    healthCheck: async () => {
      calls.push(id)
      return { ok: true }
    },
  })

  it('reports readiness and health per adapter', async () => {
    const engine = engineWith([
      entry(createFakeAdapter({ id: 'ready', results: hits('r.com', 1) }), { order: 0 }),
      entry(createFakeAdapter({ id: 'unconfigured', ready: 'missing key' }), { order: 1 }),
    ])

    const reports = await engine.health()

    expect(reports).toEqual([
      // No `healthCheck` to call, so nothing was probed — the row says so rather
      // than letting a consumer read `ok: true` as "verified".
      { id: 'ready', ready: true, ok: true, probeCost: 'free', probed: false },
      { id: 'unconfigured', ready: false, ok: false, detail: 'missing key', probeCost: 'free', probed: false },
    ])
  })

  it('spends nothing beyond the probe budget', async () => {
    const calls: string[] = []
    const engine = engineWith([
      entry(probeAdapter('model-native', calls, { probeCost: 'free' }), { order: 0 }),
      entry(probeAdapter('browser', calls, { probeCost: 'heavy' }), { order: 1 }),
      entry(probeAdapter('firecrawl', calls, { probeCost: 'billable' }), { order: 2 }),
    ])

    const reports = await engine.health({ probe: true, maxProbeCost: 'free' })

    expect(calls).toEqual(['model-native'])
    expect(reports.map((report) => [report.id, report.probed])).toEqual([
      ['model-native', true],
      ['browser', false],
      ['firecrawl', false],
    ])
  })

  it('assumes an undeclared probe bills when the adapter is metered', async () => {
    // Pessimistic on purpose: guessing downwards costs a surprise invoice,
    // guessing upwards costs one row that says "not verified" until asked.
    const calls: string[] = []
    const engine = engineWith([
      entry(probeAdapter('paid', calls, { cost: 'metered' }), { order: 0 }),
      entry(probeAdapter('gratis', calls, { cost: 'free' }), { order: 1 }),
    ])

    const reports = await engine.health({ probe: true, maxProbeCost: 'free' })

    expect(calls).toEqual(['gratis'])
    expect(reports.find((report) => report.id === 'paid')?.probeCost).toBe('billable')
  })

  it('limits a targeted re-test to the adapter that was asked for', async () => {
    const calls: string[] = []
    const engine = engineWith([
      entry(probeAdapter('alpha', calls, { probeCost: 'billable' }), { order: 0 }),
      entry(probeAdapter('beta', calls, { probeCost: 'billable' }), { order: 1 }),
    ])

    await engine.health({ probe: true, only: ['beta'] })

    expect(calls).toEqual(['beta'])
  })

  it('probes everything by default, so existing callers keep their behaviour', async () => {
    const calls: string[] = []
    const engine = engineWith([
      entry(probeAdapter('alpha', calls, { probeCost: 'billable' }), { order: 0 }),
      entry(probeAdapter('beta', calls, { probeCost: 'heavy' }), { order: 1 }),
    ])

    await engine.health()

    expect(calls.sort()).toEqual(['alpha', 'beta'])
  })
})
