import {
  getActiveProvider,
  setActiveProvider,
  resetActiveProvider,
  registerProvider,
  getRegisteredProvider,
} from '../provider/registry'
import type { Span, TelemetryProvider } from '../types'

// The provider registry stores state on this global symbol (see registry.ts).
// It is load-bearing: the worker bootstrap esbuild-bundles a PRIVATE copy of the
// telemetry module while job handlers load the SOURCE copy, and only a global
// (not module-local) singleton lets those copies share one active provider.
const GLOBAL_KEY = Symbol.for('@open-mercato/telemetry.providerRegistry')

function fakeProvider(name: string): TelemetryProvider {
  return {
    name,
    supports: [],
    async start() {},
    async shutdown() {},
    runInSpan: (_n, _o, fn) => fn({} as Span),
    activeSpan: () => undefined,
    activeTraceContext: () => undefined,
    inject: () => {},
    runInRemoteSpan: (_c, _n, _o, fn) => fn({} as Span),
    emitLog: () => {},
    recordMetric: () => {},
  }
}

afterEach(() => {
  resetActiveProvider()
})

describe('provider registry (global singleton)', () => {
  it('defaults to a noop provider', () => {
    expect(getActiveProvider().name).toBe('noop')
  })

  it('stores the active provider on globalThis, not in module-local state', () => {
    const p = fakeProvider('otlp')
    setActiveProvider(p)
    const store = (globalThis as Record<symbol, { active: TelemetryProvider } | undefined>)[GLOBAL_KEY]
    expect(store?.active).toBe(p)
    expect(getActiveProvider()).toBe(p)
  })

  it('shares the active provider across a separately-loaded module copy (dual-copy guard)', () => {
    const p = fakeProvider('otlp')
    setActiveProvider(p)
    // A second, isolated copy of the registry module — its own module closure,
    // mimicking the worker's bundled-DI vs source-handler copies. With a global
    // singleton it resolves the SAME provider; with module-local state it would
    // see its own fresh noop default and this would fail.
    let copyActive: TelemetryProvider | undefined
    jest.isolateModules(() => {
      copyActive = (require('../provider/registry') as typeof import('../provider/registry')).getActiveProvider()
    })
    expect(copyActive).toBe(p)
  })

  it('registerProvider / getRegisteredProvider round-trips by name', () => {
    const p = fakeProvider('otlp')
    registerProvider(p)
    expect(getRegisteredProvider('otlp')).toBe(p)
    expect(getRegisteredProvider('nope')).toBeUndefined()
  })

  it('resetActiveProvider restores the noop default and clears registrations', () => {
    setActiveProvider(fakeProvider('otlp'))
    registerProvider(fakeProvider('newrelic'))
    resetActiveProvider()
    expect(getActiveProvider().name).toBe('noop')
    expect(getRegisteredProvider('newrelic')).toBeUndefined()
  })
})
