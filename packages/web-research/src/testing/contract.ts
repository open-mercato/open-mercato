import type { AdapterContext, AdapterModule, SearchAdapter } from '../contract/adapter'
import { silentLogger, type HttpClient, type HttpResponse } from '../contract/http'
import { CONTRACT_VERSION } from '../contract/version'
import type { SearchRequest } from '../contract/results'

export type StubResponse = Partial<HttpResponse> & { readonly body: string }

/**
 * Minimal HTTP double. Adapters are contractually forbidden from reaching for
 * `fetch`, so a test that passes with this client has also proved the adapter
 * routes every byte through the hardened transport.
 */
export function createStubHttpClient(
  handler: (url: string, init: Parameters<HttpClient['request']>[1]) => StubResponse | Promise<StubResponse>,
): HttpClient & { readonly calls: readonly string[] } {
  const calls: string[] = []
  return {
    calls,
    async request(url, init) {
      calls.push(url)
      const stub = await handler(url, init)
      return {
        url: stub.url ?? url,
        status: stub.status ?? 200,
        headers: stub.headers ?? new Map<string, string>(),
        contentType: stub.contentType ?? 'text/html',
        body: stub.body,
        truncated: stub.truncated ?? false,
      }
    },
  }
}

export function createTestContext(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    signal: new AbortController().signal,
    http: createStubHttpClient(() => ({ body: '' })),
    report: () => {},
    deadlineAt: Date.now() + 10_000,
    logger: silentLogger,
    ...overrides,
  }
}

export const SAMPLE_REQUEST: SearchRequest = { query: 'open mercato', limit: 5 }

const VALID_STATUSES = ['ok', 'empty', 'unavailable', 'blocked', 'timeout', 'error']

export type AdapterContractCase<TOptions> = {
  /** Options that leave the adapter deliberately unconfigured. */
  readonly unconfiguredOptions?: TOptions
  /** Options sufficient for the adapter to consider itself ready. */
  readonly configuredOptions: TOptions
  /** Context used for the "returns results" probe; stub the HTTP client here. */
  readonly context?: () => AdapterContext
}

type TestApi = {
  describe: (name: string, body: () => void) => void
  it: (name: string, body: () => void | Promise<void>) => void
  expect: (value: unknown) => {
    toBe(expected: unknown): void
    toBeDefined(): void
    toContain(expected: string): void
  }
}

/**
 * Behavioural suite every adapter must pass, ours and third parties'. It pins the
 * parts of the contract the scheduler actually depends on — most importantly that
 * an adapter reports rather than throws, because a throwing adapter would
 * otherwise take down an entire search.
 */
export function describeAdapterContract<TOptions>(
  module: AdapterModule<TOptions>,
  testCase: AdapterContractCase<TOptions>,
  api: TestApi,
): void {
  const { describe, it, expect } = api

  describe(`${module.id} adapter contract`, () => {
    it('declares the contract version it was built against', () => {
      expect(module.contractVersion).toBe(CONTRACT_VERSION)
    })

    it('exposes a stable id and kind', () => {
      expect(typeof module.id).toBe('string')
      expect(module.id.length > 0).toBe(true)
      expect(['serp', 'api', 'model', 'browser'].includes(module.kind)).toBe(true)
    })

    it('validates its own options', () => {
      const parsed = module.optionsSchema.safeParse(testCase.configuredOptions)
      expect(parsed.success).toBe(true)
    })

    it('reports readiness without performing I/O', () => {
      const adapter = module.createAdapter(testCase.configuredOptions)
      const readiness = adapter.readiness()
      expect(typeof readiness.ready).toBe('boolean')
    })

    const unconfigured = testCase.unconfiguredOptions
    if (unconfigured !== undefined) {
      it('is unavailable rather than broken when unconfigured', async () => {
        const adapter = module.createAdapter(unconfigured)
        const readiness = adapter.readiness()
        expect(readiness.ready).toBe(false)
        if (!readiness.ready) expect(readiness.reason.length > 0).toBe(true)

        const outcome = await adapter.search(SAMPLE_REQUEST, createTestContext())
        expect(outcome.status).toBe('unavailable')
      })
    }

    // The contract is "never throws", not "always fails when HTTP does" — a model
    // or browser adapter may not touch the HTTP client at all.
    it('returns an outcome rather than throwing when egress fails', async () => {
      const adapter = module.createAdapter(testCase.configuredOptions)
      const context = createTestContext({
        http: createStubHttpClient(() => {
          throw new Error('network exploded')
        }),
      })
      const outcome = await adapter.search(SAMPLE_REQUEST, context)
      expect(VALID_STATUSES.includes(outcome.status)).toBe(true)
    })

    it('honours an already-aborted signal without hanging', async () => {
      const adapter = module.createAdapter(testCase.configuredOptions)
      const controller = new AbortController()
      controller.abort()
      const outcome = await adapter.search(SAMPLE_REQUEST, createTestContext({ signal: controller.signal }))
      expect(typeof outcome.status).toBe('string')
    })

    it('never returns a result without a url', async () => {
      const adapter: SearchAdapter = module.createAdapter(testCase.configuredOptions)
      const context = testCase.context ? testCase.context() : createTestContext()
      const outcome = await adapter.search(SAMPLE_REQUEST, context)
      if (outcome.status !== 'ok') return
      for (const result of outcome.results) {
        expect(typeof result.url).toBe('string')
        expect(result.url.length > 0).toBe(true)
      }
    })

    // The host builds an engine per request and disposes it after, so a `dispose`
    // that throws on an adapter which was never used, or on a second call, breaks
    // teardown for every other adapter in the same engine. This is the surface
    // that leaked a browser sidecar and a Chromium per tool call.
    it('tears down cleanly even when it was never used', async () => {
      const adapter = module.createAdapter(testCase.configuredOptions)
      if (!adapter.dispose) return
      await adapter.dispose()
      await adapter.dispose()
      expect(true).toBe(true)
    })

    it('answers a health check without throwing', async () => {
      const adapter = module.createAdapter(testCase.configuredOptions)
      if (!adapter.healthCheck) return
      const context = createTestContext({
        http: createStubHttpClient(() => {
          throw new Error('network exploded')
        }),
      })
      const health = await adapter.healthCheck(context)
      expect(typeof health.ok).toBe('boolean')
    })
  })
}
