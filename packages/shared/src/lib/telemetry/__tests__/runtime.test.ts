import {
  captureTelemetryTrace,
  getTelemetryRuntime,
  isTelemetryBackendEnabled,
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  withTelemetrySpan,
  type TelemetryRuntime,
  type TelemetrySpan,
  type TelemetrySpanOptions,
  type TelemetryTraceCarrier,
} from '../runtime'

type SpanCall = { name: string; options?: TelemetrySpanOptions }

function createRuntime(overrides: Partial<TelemetryRuntime> = {}): TelemetryRuntime {
  return {
    canUseGlobalTracePropagation: () => true,
    captureTraceContext: () => ({}),
    continueTrace: (_carrier, _name, fn) => fn(),
    recordHttpDuration: () => {},
    reportError: () => {},
    shutdown: async () => {},
    ...overrides,
  }
}

function createTracingRuntime(): { runtime: TelemetryRuntime; calls: SpanCall[]; span: TelemetrySpan } {
  const calls: SpanCall[] = []
  const span: TelemetrySpan = { setAttributes: jest.fn(), updateName: jest.fn() }
  const runtime = createRuntime({
    withSpan: (name, fn, options) => {
      calls.push({ name, options })
      return fn(span)
    },
  })
  return { runtime, calls, span }
}

describe('isTelemetryBackendEnabled', () => {
  const originalBackend = process.env.TELEMETRY_BACKEND

  afterEach(() => {
    if (originalBackend === undefined) delete process.env.TELEMETRY_BACKEND
    else process.env.TELEMETRY_BACKEND = originalBackend
  })

  it('recognizes every supported backend', () => {
    for (const backend of ['console', 'signoz', 'newrelic', 'otlp']) {
      expect(isTelemetryBackendEnabled(backend)).toBe(true)
    }
  })

  it('normalizes surrounding whitespace and casing', () => {
    expect(isTelemetryBackendEnabled('  CoNsOle  ')).toBe(true)
    expect(isTelemetryBackendEnabled('\tOTLP\n')).toBe(true)
  })

  it('rejects unknown, blank, and missing values', () => {
    expect(isTelemetryBackendEnabled('off')).toBe(false)
    expect(isTelemetryBackendEnabled('consoles')).toBe(false)
    expect(isTelemetryBackendEnabled('')).toBe(false)
    expect(isTelemetryBackendEnabled('   ')).toBe(false)

    delete process.env.TELEMETRY_BACKEND
    expect(isTelemetryBackendEnabled()).toBe(false)
  })

  it('falls back to TELEMETRY_BACKEND only when no value is passed', () => {
    process.env.TELEMETRY_BACKEND = 'signoz'
    expect(isTelemetryBackendEnabled()).toBe(true)
    expect(isTelemetryBackendEnabled('off')).toBe(false)

    process.env.TELEMETRY_BACKEND = 'off'
    expect(isTelemetryBackendEnabled()).toBe(false)
    expect(isTelemetryBackendEnabled('console')).toBe(true)
  })
})

describe('telemetry runtime registry', () => {
  afterEach(() => {
    resetTelemetryRuntime()
  })

  it('exposes no runtime until one is registered', () => {
    expect(getTelemetryRuntime()).toBeUndefined()
  })

  it('exposes the registered runtime across separate lookups', () => {
    const runtime = createRuntime()
    registerTelemetryRuntime(runtime)

    expect(getTelemetryRuntime()).toBe(runtime)
    expect(getTelemetryRuntime()).toBe(runtime)
  })

  it('clears the runtime when its own disposer runs', () => {
    const dispose = registerTelemetryRuntime(createRuntime())
    dispose()

    expect(getTelemetryRuntime()).toBeUndefined()
  })

  it('leaves a newer runtime in place when a superseded disposer runs', () => {
    const first = createRuntime()
    const second = createRuntime()
    const disposeFirst = registerTelemetryRuntime(first)
    registerTelemetryRuntime(second)

    disposeFirst()

    expect(getTelemetryRuntime()).toBe(second)
  })

  it('clears the runtime on reset', () => {
    registerTelemetryRuntime(createRuntime())
    resetTelemetryRuntime()

    expect(getTelemetryRuntime()).toBeUndefined()
  })
})

describe('withTelemetrySpan', () => {
  afterEach(() => {
    resetTelemetryRuntime()
  })

  it('runs the callback untraced with a usable noop span when telemetry is off', () => {
    const seen: TelemetrySpan[] = []
    const result = withTelemetrySpan('job.batch', (span) => {
      seen.push(span)
      span.setAttributes({ 'om.tenant_id': 'tenant-1', count: 2, ok: true })
      span.updateName?.('job.batch.renamed')
      return 'done'
    })

    expect(result).toBe('done')
    expect(seen).toHaveLength(1)
  })

  it('runs the callback untraced when the registered runtime predates span support', () => {
    registerTelemetryRuntime(createRuntime())

    const result = withTelemetrySpan('job.batch', (span) => {
      span.setAttributes({ ok: true })
      return 41 + 1
    })

    expect(result).toBe(42)
  })

  it('delegates to the runtime and forwards the name, options, and span', () => {
    const { runtime, calls, span } = createTracingRuntime()
    registerTelemetryRuntime(runtime)

    const options: TelemetrySpanOptions = {
      kind: 'consumer',
      root: true,
      links: [{ traceparent: '00-aaaa-bbbb-01' }],
      attributes: { 'data_sync.batch_index': 3 },
    }

    const result = withTelemetrySpan(
      'data_sync.import.batch',
      (received) => {
        expect(received).toBe(span)
        received.setAttributes({ 'data_sync.records': 10 })
        return 'traced'
      },
      options,
    )

    expect(result).toBe('traced')
    expect(calls).toEqual([{ name: 'data_sync.import.batch', options }])
    expect(span.setAttributes).toHaveBeenCalledWith({ 'data_sync.records': 10 })
  })

  it('propagates a callback failure from the traced path', () => {
    const { runtime } = createTracingRuntime()
    registerTelemetryRuntime(runtime)

    expect(() =>
      withTelemetrySpan('data_sync.import.batch', () => {
        throw new Error('[internal] batch failed')
      }),
    ).toThrow('[internal] batch failed')
  })
})

describe('captureTelemetryTrace', () => {
  afterEach(() => {
    resetTelemetryRuntime()
  })

  it('returns undefined when telemetry is off', () => {
    expect(captureTelemetryTrace()).toBeUndefined()
  })

  it('returns undefined when the active runtime captures an empty carrier', () => {
    registerTelemetryRuntime(createRuntime({ captureTraceContext: () => ({}) }))

    expect(captureTelemetryTrace()).toBeUndefined()
  })

  it('returns the captured carrier when a trace is active', () => {
    const carrier: TelemetryTraceCarrier = { traceparent: '00-aaaa-bbbb-01' }
    registerTelemetryRuntime(createRuntime({ captureTraceContext: () => carrier }))

    expect(captureTelemetryTrace()).toEqual(carrier)
  })
})
