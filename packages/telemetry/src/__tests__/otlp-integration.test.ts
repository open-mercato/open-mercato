/**
 * The real OtlpProvider wired to in-memory OTEL exporters (no network,
 * deterministic). Proves the OTEL-specific behaviour our design relies on:
 * span shape, the delegation/nesting model, cross-boundary trace propagation
 * (same traceId), root-per-request, log correlation, and metrics.
 */
import { SpanStatusCode, propagation, trace, context, ROOT_CONTEXT } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { InMemoryLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { InMemoryMetricExporter, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics'

import { OtlpProvider } from '../provider/otlp-provider'
import {
  createLogger,
  resetLoggerExtension,
  resetLoggerRegistry,
} from '@open-mercato/shared/lib/logger'
import { setActiveProvider, resetActiveProvider } from '../provider/registry'
import { resetTelemetryEnvCache } from '../env'
import { registerTelemetryLogger } from '../facade/logger-bridge'
import { withSpan, captureTraceContext, continueTrace, reportError, counter } from '../index'

const spanExporter = new InMemorySpanExporter()
const logExporter = new InMemoryLogRecordExporter()
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter })

let provider: OtlpProvider
let disposeLogger: (() => void) | undefined
const logger = createLogger('telemetry-test')

function parentSpanId(span: ReadableSpan): string | undefined {
  const s = span as { parentSpanContext?: { spanId?: string }; parentSpanId?: string }
  return s.parentSpanContext?.spanId ?? s.parentSpanId
}

beforeAll(async () => {
  process.env.TELEMETRY_BACKEND = 'otlp'
  resetTelemetryEnvCache()
  provider = new OtlpProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    logRecordProcessors: [new SimpleLogRecordProcessor(logExporter)],
    metricReaders: [metricReader],
    instrumentations: [], // pure facade behaviour — pg/undici patching is OTEL's own code
  })
  await provider.start()
  setActiveProvider(provider)
  disposeLogger = registerTelemetryLogger(provider)
  // The first span after NodeSDK.start() can be dropped while the global tracer
  // provider finishes installing — warm it up, settle a tick, then reset.
  withSpan('warmup', () => undefined)
  await new Promise((resolve) => setTimeout(resolve, 10))
  spanExporter.reset()
})

afterEach(() => {
  spanExporter.reset()
  logExporter.reset()
  metricExporter.reset()
  delete process.env.TELEMETRY_TRUST_INBOUND_TRACE
  resetTelemetryEnvCache()
})

afterAll(async () => {
  await provider.shutdown()
  disposeLogger?.()
  resetLoggerExtension()
  resetLoggerRegistry()
  resetActiveProvider()
  delete process.env.TELEMETRY_BACKEND
  resetTelemetryEnvCache()
})

describe('OtlpProvider (in-memory exporters)', () => {
  it('records span name, attributes (dropping undefined), and ok status', () => {
    withSpan('op', (s) => s.setAttribute('x', 1), { attributes: { a: 'b', skip: undefined } })
    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'op')
    expect(span).toBeDefined()
    expect(span?.attributes.a).toBe('b')
    expect(span?.attributes.x).toBe(1)
    expect(span?.attributes).not.toHaveProperty('skip')
    expect(span?.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('records exceptions + error status on a span', () => {
    withSpan('boom', (s) => {
      s.recordException(new Error('kaboom'))
      s.setStatus('error', 'failed')
    })
    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'boom')
    expect(span?.status.code).toBe(SpanStatusCode.ERROR)
    expect(span?.events.some((e) => e.name === 'exception')).toBe(true)
  })

  it('nests child spans under the parent (delegation model)', () => {
    withSpan('parent', () => withSpan('child', () => undefined))
    const spans = spanExporter.getFinishedSpans()
    const parent = spans.find((s) => s.name === 'parent')
    const child = spans.find((s) => s.name === 'child')
    expect(parent && child).toBeTruthy()
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId)
    expect(parentSpanId(child as ReadableSpan)).toBe(parent?.spanContext().spanId)
  })

  it('inject() writes a valid W3C traceparent inside an active span', () => {
    let carrier: Record<string, string> = {}
    withSpan('producer', () => {
      carrier = captureTraceContext()
    })
    expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
  })

  it('propagates trace context across a boundary: consumer shares the producer traceId', () => {
    let carrier: Record<string, string> = {}
    withSpan('producer', () => {
      carrier = captureTraceContext()
    })
    const producer = spanExporter.getFinishedSpans().find((s) => s.name === 'producer')
    const producerTraceId = producer?.spanContext().traceId ?? ''
    const producerSpanId = producer?.spanContext().spanId ?? ''

    continueTrace(carrier, 'consumer', () => undefined)
    const consumer = spanExporter.getFinishedSpans().find((s) => s.name === 'consumer')

    expect(producerTraceId).toMatch(/^[0-9a-f]{32}$/)
    expect(consumer?.spanContext().traceId).toBe(producerTraceId)
    expect(parentSpanId(consumer as ReadableSpan)).toBe(producerSpanId)
  })

  it('roots per request: the global propagator drops inbound HTTP context while the queue carrier still propagates', () => {
    // A carrier as if a load balancer injected an upstream traceparent.
    let carrier: Record<string, string> = {}
    withSpan('upstream', () => {
      carrier = captureTraceContext()
    })
    const upstreamTraceId = carrier.traceparent.split('-')[1]

    // Incoming HTTP uses the GLOBAL propagator — it must IGNORE the inbound
    // context so the request span becomes a fresh root (not a child of the LB).
    const extracted = propagation.extract(ROOT_CONTEXT, carrier)
    expect(trace.getSpanContext(extracted)).toBeUndefined()

    // Queue path uses the dedicated propagator — it must STILL honor the carrier.
    continueTrace(carrier, 'consumer', () => undefined)
    const consumer = spanExporter.getFinishedSpans().find((s) => s.name === 'consumer')
    expect(consumer?.spanContext().traceId).toBe(upstreamTraceId)
  })

  it('global inject writes a backup x-original-traceparent that mirrors traceparent', () => {
    const carrier: Record<string, string> = {}
    withSpan('producer', () => {
      propagation.inject(context.active(), carrier)
    })
    expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    expect(carrier['x-original-traceparent']).toBe(carrier.traceparent)
  })

  it('global extract rejects a caller-supplied backup header by default', () => {
    const carrier: Record<string, string> = {}
    withSpan('producer', () => {
      propagation.inject(context.active(), carrier)
    })
    // Simulate the load balancer rewriting `traceparent` to its own (unexported) span.
    carrier.traceparent = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`

    const extracted = propagation.extract(ROOT_CONTEXT, carrier)
    expect(trace.getSpanContext(extracted)).toBeUndefined()
  })

  it('global extract trusts the backup header only after explicit opt-in', () => {
    const carrier: Record<string, string> = {}
    withSpan('producer', () => {
      propagation.inject(context.active(), carrier)
    })
    const realTraceId = carrier['x-original-traceparent'].split('-')[1]
    carrier.traceparent = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`
    process.env.TELEMETRY_TRUST_INBOUND_TRACE = 'true'
    resetTelemetryEnvCache()

    const extracted = propagation.extract(ROOT_CONTEXT, carrier)
    expect(trace.getSpanContext(extracted)?.traceId).toBe(realTraceId)
    expect(trace.getSpanContext(extracted)?.traceId).not.toBe('a'.repeat(32))
  })

  it('global extract roots on a bare inbound traceparent with no backup (LB on entry)', () => {
    const carrier = { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` }
    const extracted = propagation.extract(ROOT_CONTEXT, carrier)
    expect(trace.getSpanContext(extracted)).toBeUndefined()
  })

  it('redacts a leaked email from a span exception (PII backstop at the OTEL boundary)', () => {
    withSpan('pii-span', (s) => {
      s.recordException(new Error('no account for jan.kowalski@example.com'))
    })
    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'pii-span')
    const exception = span?.events.find((e) => e.name === 'exception')
    const message = String(exception?.attributes?.['exception.message'] ?? '')
    expect(message).toContain('[redacted-email]')
    expect(message).not.toContain('jan.kowalski@example.com')
  })

  it('redacts secret span attributes at the OTEL provider boundary', () => {
    withSpan('secret-span', (span) => {
      span.setAttributes({
        token: 'secret-token',
        note: 'contact jane@example.com',
        token_count: 12,
      })
    })
    const span = spanExporter.getFinishedSpans().find((item) => item.name === 'secret-span')
    expect(span?.attributes.token).toBe('[redacted]')
    expect(span?.attributes.note).toBe('contact [redacted-email]')
    expect(span?.attributes.token_count).toBe(12)
  })

  it('emits structured logs and error exceptions through reportError', () => {
    logger.info('hello', { k: 1 })
    reportError(new Error('explode'), { module: 'orders' })
    const records = logExporter.getFinishedLogRecords()
    const info = records.find((r) => r.body === 'hello')
    expect(info?.attributes?.k).toBe(1)
    const err = records.find((r) => r.severityText === 'error')
    expect(err?.attributes?.['exception.message']).toBe('explode')
  })

  it('redacts direct provider logs at the final export boundary', () => {
    provider.emitLog({
      level: 'warn',
      message: 'upstream rejected Bearer raw-token',
      attributes: {
        token: 'raw-token',
        note: 'owner@example.com',
        token_count: 3,
      },
    })
    const record = logExporter.getFinishedLogRecords().find((item) => item.severityText === 'warn')
    expect(record?.body).toBe('upstream rejected Bearer [redacted]')
    expect(record?.attributes?.token).toBe('[redacted]')
    expect(record?.attributes?.note).toBe('[redacted-email]')
    expect(record?.attributes?.token_count).toBe(3)
  })

  it('exposes the active trace context for log correlation (undefined when none active)', () => {
    expect(provider.activeTraceContext()).toBeUndefined()
    let seen: { traceId: string; spanId: string } | undefined
    withSpan('logged-op', () => {
      seen = provider.activeTraceContext()
    })
    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'logged-op')
    expect(seen?.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(seen?.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(seen?.traceId).toBe(span?.spanContext().traceId)
    expect(seen?.spanId).toBe(span?.spanContext().spanId)
  })

  it('records metrics through the OTEL meter', async () => {
    counter('om.errors', 1, { module: 'orders' })
    await metricReader.forceFlush()
    const metricNames = metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name)))
    expect(metricNames).toContain('om.errors')
  })
})
