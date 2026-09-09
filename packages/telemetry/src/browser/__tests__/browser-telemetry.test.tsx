/**
 * @jest-environment jsdom
 */

/**
 * The browser runtime itself: what actually loads the SDK, what patches global
 * fetch, and what must never happen while RUM is off. The OTel web SDK is mocked
 * — the point here is our wiring, not OpenTelemetry's. Trace continuity against
 * the real server extractor is covered in `__tests__/otlp-integration.test.ts`.
 */
import * as React from 'react'
import { act, render } from '@testing-library/react'
import { BrowserTelemetry, resetBrowserTelemetryBootstrap } from '../BrowserTelemetry'
import { BROWSER_TRACES_PATH, type BrowserTelemetryConfig } from '../config'
import { BACKUP_TRACEPARENT_HEADER, BACKUP_TRACESTATE_HEADER } from '../../trace-headers'
import type { TextMapPropagator } from '@opentelemetry/api'

/** Which SDK modules were dynamically imported — the "zero client cost while off" claim. */
const mockLoadedModules: string[] = []
const mockProviderInstances: Array<{
  options: Record<string, unknown>
  register: jest.Mock
  forceFlush: jest.Mock
}> = []
const mockFetchInstrumentationConfigs: Array<{ ignoreUrls?: RegExp[] }> = []
/**
 * Arms the next `new FetchInstrumentation(...)` to throw. The constructors are evaluated as
 * arguments to `registerInstrumentations`, i.e. while the native fetch is swapped in — so this is
 * the seam that reproduces a throw landing mid-swap (SDK version skew, a missing browser API).
 */
const mockFetchInstrumentationFailure: { next: Error | null } = { next: null }
const mockExporterConfigs: Array<{ url?: string }> = []
const mockRegisterInstrumentations = jest.fn()
/** Stands in for the fetch OTel's FetchInstrumentation.enable() installs, synchronously. */
const mockOtelPatchedFetch = jest.fn() as unknown as typeof window.fetch

function record<T>(moduleName: string, exports: T): T {
  mockLoadedModules.push(moduleName)
  return exports
}

jest.mock('@opentelemetry/sdk-trace-web', () =>
  record('@opentelemetry/sdk-trace-web', {
    WebTracerProvider: class {
      register = jest.fn()
      forceFlush = jest.fn(async () => {})
      constructor(options: Record<string, unknown>) {
        mockProviderInstances.push({ options, register: this.register, forceFlush: this.forceFlush })
      }
    },
  }),
)

jest.mock('@opentelemetry/sdk-trace-base', () =>
  record('@opentelemetry/sdk-trace-base', {
    BatchSpanProcessor: class {},
    ParentBasedSampler: class {},
    TraceIdRatioBasedSampler: class {},
  }),
)

jest.mock('@opentelemetry/exporter-trace-otlp-http', () =>
  record('@opentelemetry/exporter-trace-otlp-http', {
    OTLPTraceExporter: class {
      constructor(config: { url?: string }) {
        mockExporterConfigs.push(config)
      }
    },
  }),
)

jest.mock('@opentelemetry/resources', () =>
  record('@opentelemetry/resources', {
    resourceFromAttributes: (attributes: Record<string, unknown>) => attributes,
  }),
)

jest.mock('@opentelemetry/instrumentation', () =>
  record('@opentelemetry/instrumentation', {
    registerInstrumentations: (...args: unknown[]) => {
      // The real call enables each instrumentation inline, and FetchInstrumentation's enable()
      // replaces whatever `window.fetch` is at that moment. Reproducing that here is the whole
      // point of the fetch-swap assertions below.
      window.fetch = mockOtelPatchedFetch
      mockRegisterInstrumentations(...args)
    },
  }),
)

jest.mock('@opentelemetry/instrumentation-document-load', () =>
  record('@opentelemetry/instrumentation-document-load', { DocumentLoadInstrumentation: class {} }),
)

jest.mock('@opentelemetry/instrumentation-fetch', () =>
  record('@opentelemetry/instrumentation-fetch', {
    FetchInstrumentation: class {
      constructor(config: { ignoreUrls?: RegExp[] }) {
        if (mockFetchInstrumentationFailure.next) {
          const failure = mockFetchInstrumentationFailure.next
          mockFetchInstrumentationFailure.next = null
          throw failure
        }
        mockFetchInstrumentationConfigs.push(config)
      }
    },
  }),
)

jest.mock('@opentelemetry/instrumentation-user-interaction', () =>
  record('@opentelemetry/instrumentation-user-interaction', { UserInteractionInstrumentation: class {} }),
)

jest.mock('@opentelemetry/core', () =>
  record('@opentelemetry/core', {
    W3CTraceContextPropagator: class {
      inject(_ctx: unknown, carrier: Record<string, string>, setter: { set(c: unknown, k: string, v: string): void }) {
        setter.set(carrier, 'traceparent', '00-11111111111111111111111111111111-2222222222222222-01')
        setter.set(carrier, 'tracestate', 'om=1')
      }
      fields() {
        return ['traceparent', 'tracestate']
      }
    },
  }),
)

jest.mock('@opentelemetry/api', () =>
  record('@opentelemetry/api', {
    defaultTextMapSetter: {
      set: (carrier: Record<string, string>, key: string, value: string) => {
        carrier[key] = value
      },
    },
  }),
)

const CONFIG: BrowserTelemetryConfig = {
  endpoint: BROWSER_TRACES_PATH,
  serviceName: 'acme-oms-browser',
  environment: 'production',
  samplingRatio: 0.25,
}

/** The effect chains a dynamic import; one macrotask turn is enough to settle it. */
async function renderAndSettle(element: React.ReactElement): Promise<void> {
  render(element)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('BrowserTelemetry', () => {
  const nativeFetch = window.fetch

  beforeEach(() => {
    resetBrowserTelemetryBootstrap()
    mockLoadedModules.length = 0
    mockProviderInstances.length = 0
    mockFetchInstrumentationConfigs.length = 0
    mockExporterConfigs.length = 0
    mockRegisterInstrumentations.mockClear()
    mockFetchInstrumentationFailure.next = null
    window.fetch = nativeFetch
    delete (window as { __omOriginalFetch?: unknown }).__omOriginalFetch
  })

  it('loads nothing at all while telemetry is disabled — RUM must cost a disabled app zero bytes', async () => {
    await renderAndSettle(<BrowserTelemetry config={null} />)

    expect(mockLoadedModules).toEqual([])
    expect(mockProviderInstances).toHaveLength(0)
  })

  it('boots the web SDK exactly once under StrictMode, which double-invokes every effect', async () => {
    await renderAndSettle(
      <React.StrictMode>
        <BrowserTelemetry config={CONFIG} />
      </React.StrictMode>,
    )

    // A second provider would double every span and every export.
    expect(mockProviderInstances).toHaveLength(1)
    expect(mockRegisterInstrumentations).toHaveBeenCalledTimes(1)
  })

  it('stays down after a remount, because a page load gets one SDK', async () => {
    await renderAndSettle(<BrowserTelemetry config={CONFIG} />)
    await renderAndSettle(<BrowserTelemetry config={CONFIG} />)

    expect(mockProviderInstances).toHaveLength(1)
  })

  it('exports through the same-origin proxy and never instruments that export', async () => {
    await renderAndSettle(<BrowserTelemetry config={CONFIG} />)

    expect(mockExporterConfigs[0]?.url).toBe(BROWSER_TRACES_PATH)
    const ignoreUrls = mockFetchInstrumentationConfigs[0]?.ignoreUrls ?? []
    // Without this the exporter's own POST produces a span, which produces the next batch, forever.
    expect(ignoreUrls.some((pattern) => pattern.test(`http://localhost${BROWSER_TRACES_PATH}`))).toBe(true)
    expect(ignoreUrls.some((pattern) => pattern.test('http://localhost/api/customers'))).toBe(false)
  })

  it('carries the resolved service identity onto the resource', async () => {
    await renderAndSettle(<BrowserTelemetry config={CONFIG} />)

    expect(mockProviderInstances[0]?.options.resource).toMatchObject({
      'service.name': 'acme-oms-browser',
      'deployment.environment': 'production',
    })
  })

  it('injects the backup trace headers alongside the standard ones', async () => {
    await renderAndSettle(<BrowserTelemetry config={CONFIG} />)

    const registerArg = mockProviderInstances[0]?.register.mock.calls[0][0] as {
      propagator: TextMapPropagator
    }
    const carrier: Record<string, string> = {}
    registerArg.propagator.inject({} as never, carrier, {
      set: (target: Record<string, string>, key: string, value: string) => {
        target[key] = value
      },
    })

    // The backup copy is what survives a load balancer rewriting `traceparent`.
    expect(carrier[BACKUP_TRACEPARENT_HEADER]).toBe(carrier.traceparent)
    expect(carrier[BACKUP_TRACESTATE_HEADER]).toBe(carrier.tracestate)
    expect(registerArg.propagator.fields()).toEqual(
      expect.arrayContaining([BACKUP_TRACEPARENT_HEADER, BACKUP_TRACESTATE_HEADER]),
    )
  })

  describe('global fetch instrumentation', () => {
    it('instruments the native fetch behind the framework wrapper, without recursing', async () => {
      // What `@open-mercato/ui`'s api utils install at module load: the pristine fetch stashed
      // aside, and a wrapper in its place. (jsdom ships no `fetch`, hence the explicit stub.)
      const pristineFetch = jest.fn() as unknown as typeof window.fetch
      const frameworkFetch = jest.fn() as unknown as typeof window.fetch
      ;(window as { __omOriginalFetch?: typeof window.fetch }).__omOriginalFetch = pristineFetch
      window.fetch = frameworkFetch

      await renderAndSettle(<BrowserTelemetry config={CONFIG} />)

      // The framework wrapper stays the public entry point, so 401/403 handling is untouched…
      expect(window.fetch).toBe(frameworkFetch)
      // …and the fetch it delegates to is now the instrumented one, so direct apiFetch callers
      // (DataTable, CrudForm, react-query) produce spans too.
      expect((window as { __omOriginalFetch?: typeof window.fetch }).__omOriginalFetch).toBe(mockOtelPatchedFetch)
      // Handing the wrapper back to itself would loop forever on the first request.
      expect((window as { __omOriginalFetch?: typeof window.fetch }).__omOriginalFetch).not.toBe(frameworkFetch)
    })

    it('instruments window.fetch directly when the framework wrapper is absent', async () => {
      await renderAndSettle(<BrowserTelemetry config={CONFIG} />)

      expect(window.fetch).toBe(mockOtelPatchedFetch)
      expect((window as { __omOriginalFetch?: typeof window.fetch }).__omOriginalFetch).toBeUndefined()
    })

    it('puts the framework wrapper back when instrumentation setup throws mid-swap', async () => {
      const pristineFetch = jest.fn() as unknown as typeof window.fetch
      const frameworkFetch = jest.fn() as unknown as typeof window.fetch
      ;(window as { __omOriginalFetch?: typeof window.fetch }).__omOriginalFetch = pristineFetch
      window.fetch = frameworkFetch
      mockFetchInstrumentationFailure.next = new Error('SDK version skew')

      await renderAndSettle(<BrowserTelemetry config={CONFIG} />)

      // Without the `finally`, `window.fetch` would stay the raw native fetch for the rest of the
      // page's life and every stray caller would silently lose the 401 session-refresh and 403
      // banner behaviour the framework wrapper exists for. Nothing logs, so it would be invisible.
      expect(window.fetch).toBe(frameworkFetch)
      expect((window as { __omOriginalFetch?: typeof window.fetch }).__omOriginalFetch).toBe(pristineFetch)
      expect(mockRegisterInstrumentations).not.toHaveBeenCalled()
    })
  })

  it('flushes queued spans when the tab is hidden — an abandoned slow page is the one worth keeping', async () => {
    await renderAndSettle(<BrowserTelemetry config={CONFIG} />)
    const { forceFlush } = mockProviderInstances[0]

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(forceFlush).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(forceFlush).toHaveBeenCalledTimes(1)
  })

  it('stays silent when the SDK fails to boot — telemetry may never degrade the app it measures', async () => {
    mockRegisterInstrumentations.mockImplementationOnce(() => {
      throw new Error('SDK exploded')
    })

    await expect(renderAndSettle(<BrowserTelemetry config={CONFIG} />)).resolves.toBeUndefined()
  })
})
