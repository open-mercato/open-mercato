import type {
  Attributes,
  LogRecord,
  MetricPoint,
  Span,
  SpanOptions,
  TelemetryProvider,
  TraceCarrier,
  TraceContext,
} from '../types'

function createSpan(): Span {
  return {
    setAttribute(_key: string, _value: string | number | boolean): void {},
    setAttributes(_attributes: Attributes): void {},
    recordException(_error: unknown): void {},
    setStatus(_status: 'ok' | 'error', _message?: string): void {},
    end(): void {},
  }
}

function createProvider(name = 'otlp'): TelemetryProvider {
  const span = createSpan()
  return {
    name,
    supports: ['traces', 'metrics', 'logs', 'errors'],
    start: jest.fn(async () => {}),
    shutdown: jest.fn(async () => {}),
    runInSpan<T>(_name: string, _options: SpanOptions, operation: (activeSpan: Span) => T): T {
      return operation(span)
    },
    activeSpan(): Span | undefined {
      return span
    },
    activeTraceContext(): TraceContext | undefined {
      return undefined
    },
    inject(_carrier: TraceCarrier): void {},
    runInRemoteSpan<T>(
      _carrier: TraceCarrier,
      _name: string,
      _options: SpanOptions,
      operation: (activeSpan: Span) => T,
    ): T {
      return operation(span)
    },
    emitLog(_record: LogRecord): void {},
    recordMetric(_point: MetricPoint): void {},
  }
}

describe('OTLP dependency bootstrap', () => {
  const originalBackend = process.env.TELEMETRY_BACKEND
  let shutdownTelemetry: (() => Promise<void>) | undefined

  beforeEach(() => {
    jest.resetModules()
    jest.restoreAllMocks()
    shutdownTelemetry = undefined
    delete process.env.TELEMETRY_BACKEND
  })

  afterEach(async () => {
    await shutdownTelemetry?.()
    if (originalBackend === undefined) delete process.env.TELEMETRY_BACKEND
    else process.env.TELEMETRY_BACKEND = originalBackend
    jest.dontMock('../provider/console-provider')
    jest.dontMock('../provider/otlp-provider')
    jest.resetModules()
    jest.restoreAllMocks()
  })

  it.each(['otlp', 'signoz', 'newrelic'])('fails clearly when %s dependencies cannot load', async (backend) => {
    const importCause = new Error('simulated missing OpenTelemetry package')
    const consoleProvider = jest.fn()
    jest.doMock('../provider/console-provider', () => ({ ConsoleProvider: consoleProvider }))
    jest.doMock('../provider/otlp-provider', () => {
      throw importCause
    })
    const telemetry = await import('../init')
    shutdownTelemetry = telemetry.shutdownTelemetry
    process.env.TELEMETRY_BACKEND = backend

    const failure: unknown = await telemetry.initTelemetry().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(`OTLP telemetry backend "${backend}" cannot start`)
    expect((failure as Error).message).toContain('Install optional dependencies')
    expect((failure as Error).cause).toBe(importCause)
    expect(consoleProvider).not.toHaveBeenCalled()
  })

  it('starts the dynamically loaded provider when OTLP dependencies are available', async () => {
    const provider = createProvider()
    const OtlpProvider = jest.fn(() => provider)
    jest.doMock('../provider/otlp-provider', () => ({ OtlpProvider }))
    const telemetry = await import('../init')
    shutdownTelemetry = telemetry.shutdownTelemetry
    process.env.TELEMETRY_BACKEND = 'otlp'

    await telemetry.initTelemetry()

    expect(OtlpProvider).toHaveBeenCalledWith({}, 'otlp')
    expect(provider.start).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, 'noop'])('does not resolve OTLP dependencies when telemetry is %s', async (backend) => {
    const loadOtlpModule = jest.fn(() => ({ OtlpProvider: jest.fn() }))
    jest.doMock('../provider/otlp-provider', loadOtlpModule)
    const telemetry = await import('../init')
    shutdownTelemetry = telemetry.shutdownTelemetry
    if (backend === undefined) delete process.env.TELEMETRY_BACKEND
    else process.env.TELEMETRY_BACKEND = backend

    await telemetry.initTelemetry()

    expect(loadOtlpModule).not.toHaveBeenCalled()
  })

  it('can retry initialization after a dependency load failure', async () => {
    const provider = createProvider()
    const importCause = new Error('simulated first-load failure')
    let loadAttempts = 0
    jest.doMock('../provider/otlp-provider', () => {
      loadAttempts += 1
      if (loadAttempts === 1) throw importCause
      return { OtlpProvider: jest.fn(() => provider) }
    })
    const telemetry = await import('../init')
    shutdownTelemetry = telemetry.shutdownTelemetry
    process.env.TELEMETRY_BACKEND = 'otlp'

    await expect(telemetry.initTelemetry()).rejects.toHaveProperty('cause', importCause)
    await telemetry.initTelemetry()

    expect(loadAttempts).toBe(2)
    expect(provider.start).toHaveBeenCalledTimes(1)
  })
})
