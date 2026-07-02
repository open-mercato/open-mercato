import { withSpan, currentSpan, counter, reportError, captureTraceContext, continueTrace } from '../index'
import { logger } from '../facade/logger'
import { initTelemetry, resetTelemetryInit } from '../init'
import { registerProvider, resetActiveProvider } from '../provider/registry'
import { resetTelemetryEnvCache } from '../env'
import { runSpan } from '../provider/run-span'
import type { LogRecord, MetricPoint, Span, SpanOptions, TelemetryProvider, TraceCarrier } from '../types'

class RecordingSpan implements Span {
  attributes: Record<string, unknown> = {}
  exceptions: unknown[] = []
  status: 'ok' | 'error' = 'ok'
  ended = false
  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value
  }
  setAttributes(attributes: Record<string, string | number | boolean | undefined>): void {
    Object.assign(this.attributes, attributes)
  }
  recordException(error: unknown): void {
    this.exceptions.push(error)
  }
  setStatus(status: 'ok' | 'error'): void {
    this.status = status
  }
  end(): void {
    this.ended = true
  }
}

function recordingProvider() {
  const span = new RecordingSpan()
  const logs: LogRecord[] = []
  const metrics: MetricPoint[] = []
  const spanNames: string[] = []
  const remoteCarriers: TraceCarrier[] = []
  const provider: TelemetryProvider = {
    name: 'noop', // matches the default backend so initTelemetry picks it up
    supports: ['traces', 'metrics', 'logs', 'errors'],
    async start() {},
    async shutdown() {},
    runInSpan<T>(name: string, _options: SpanOptions, fn: (s: Span) => T): T {
      spanNames.push(name)
      return runSpan(span, fn)
    },
    activeSpan: () => span,
    activeTraceContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
    inject: (carrier) => {
      carrier.traceparent = 'test-traceparent'
    },
    runInRemoteSpan<T>(carrier: TraceCarrier, name: string, _options: SpanOptions, fn: (s: Span) => T): T {
      remoteCarriers.push(carrier)
      spanNames.push(name)
      return runSpan(span, fn)
    },
    emitLog: (record) => logs.push(record),
    recordMetric: (point) => metrics.push(point),
  }
  return { provider, span, logs, metrics, spanNames, remoteCarriers }
}

describe('telemetry facade', () => {
  beforeEach(() => {
    resetActiveProvider()
    resetTelemetryInit()
    resetTelemetryEnvCache()
    delete process.env.TELEMETRY_BACKEND
  })

  it('is a safe no-op when telemetry is off (default)', () => {
    expect(withSpan('work', () => 42)).toBe(42)
    expect(currentSpan()).toBeUndefined()
    expect(() => {
      logger.info('hello')
      counter('demo')
      reportError(new Error('boom'))
    }).not.toThrow()
    // Propagation helpers are safe with no backend: empty carrier, fn still runs.
    expect(captureTraceContext()).toEqual({})
    expect(continueTrace({}, 'job', () => 5)).toBe(5)
  })

  it('runs the function and returns its value inside a span', () => {
    const seen: Span[] = []
    const result = withSpan('compute', (span) => {
      seen.push(span)
      return 7
    })
    expect(result).toBe(7)
    expect(seen).toHaveLength(1)
  })

  it('awaits async work before the span ends', async () => {
    const { provider, span } = recordingProvider()
    registerProvider(provider)
    await initTelemetry()

    withSpan('tutor.turn', (s) => s.setAttributes({ subject: 'math' }))
    reportError(new Error('kaboom'), { module: 'orders' })

    expect(span.attributes.subject).toBe('math')
    expect(span.exceptions).toHaveLength(1)
    expect(span.status).toBe('error')
  })

  it('records a span, exception, error status, error log, and om.errors metric', async () => {
    const { provider, span, logs, metrics, spanNames } = recordingProvider()
    registerProvider(provider)
    await initTelemetry()

    withSpan('work.unit', (s) => s.setAttributes({ subject: 'math' }))
    reportError(new Error('kaboom'), { module: 'orders' })

    expect(spanNames).toContain('work.unit')
    expect(span.attributes.subject).toBe('math')
    expect(span.exceptions).toHaveLength(1)
    expect(span.status).toBe('error')
    expect(metrics.find((m) => m.name === 'om.errors')?.labels).toEqual({ module: 'orders' })
    expect(logs.some((l) => l.level === 'error' && l.error?.message === 'kaboom')).toBe(true)
  })

  it('propagates trace context: captureTraceContext injects, continueTrace consumes it', async () => {
    const { provider, remoteCarriers, spanNames } = recordingProvider()
    registerProvider(provider)
    await initTelemetry()

    // Producer side (e.g. enqueue): capture the active context into a carrier.
    const carrier = captureTraceContext()
    expect(carrier.traceparent).toBe('test-traceparent')

    // Consumer side (e.g. worker): continue the trace under the carrier's parent.
    const result = await continueTrace(carrier, 'queue.orders-process', async () => 'done')
    expect(result).toBe('done')
    expect(spanNames).toContain('queue.orders-process')
    expect(remoteCarriers[0]?.traceparent).toBe('test-traceparent')
  })

  it('redacts secret-keyed attributes in the reported error context before they ship', async () => {
    const { provider, logs } = recordingProvider()
    registerProvider(provider)
    await initTelemetry()

    reportError(new Error('request failed'), {
      module: 'integrations',
      attributes: { authorization: 'Bearer sk_live_abc', 'http.route': '/api/sync', 'x-api-key': 'key_123' },
    })

    const record = logs.find((l) => l.level === 'error')
    expect(record?.attributes?.authorization).toBe('[redacted]')
    expect(record?.attributes?.['x-api-key']).toBe('[redacted]')
    // low-cardinality, non-secret attributes are preserved
    expect(record?.attributes?.['http.route']).toBe('/api/sync')
    expect(record?.attributes?.module).toBe('integrations')
  })
})
