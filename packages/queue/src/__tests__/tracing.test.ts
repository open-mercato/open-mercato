import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { attachTraceMetadata, runJobInTrace } from '../tracing'
import { createLocalQueue } from '../strategies/local'
import { registerProvider, initTelemetry } from '@open-mercato/telemetry'
import type { LogRecord, MetricPoint, Span, SpanOptions, TelemetryProvider, TraceCarrier } from '@open-mercato/telemetry'

/**
 * Verifies the enqueue → worker trace handoff: the active context is captured
 * onto job metadata at enqueue, and the worker continues that trace at dispatch.
 * Uses a recording provider (named 'noop' so `initTelemetry` adopts it as the
 * active backend) rather than the real OTLP SDK.
 */
const spanNames: string[] = []
const remoteCarriers: TraceCarrier[] = []

function noopSpan(): Span {
  return { setAttribute() {}, setAttributes() {}, recordException() {}, setStatus() {}, end() {} }
}

const recordingProvider: TelemetryProvider = {
  name: 'noop',
  supports: ['traces'],
  async start() {},
  async shutdown() {},
  runInSpan<T>(name: string, _o: SpanOptions, fn: (s: Span) => T): T {
    spanNames.push(name)
    return fn(noopSpan())
  },
  activeSpan: () => undefined,
  activeTraceContext: () => undefined,
  inject: (carrier) => {
    carrier.traceparent = 'test-traceparent'
  },
  runInRemoteSpan<T>(carrier: TraceCarrier, name: string, _o: SpanOptions, fn: (s: Span) => T): T {
    remoteCarriers.push(carrier)
    spanNames.push(name)
    return fn(noopSpan())
  },
  emitLog: (_r: LogRecord) => {},
  recordMetric: (_p: MetricPoint) => {},
}

beforeAll(async () => {
  registerProvider(recordingProvider)
  await initTelemetry()
})

describe('queue trace propagation', () => {
  it('attaches the active trace carrier to job metadata at enqueue', () => {
    const metadata = attachTraceMetadata(undefined)
    expect(metadata).toEqual({ _trace: { traceparent: 'test-traceparent' } })
  })

  it('preserves existing metadata while attaching the trace carrier', () => {
    const metadata = attachTraceMetadata({ foo: 'bar' })
    expect(metadata).toMatchObject({ foo: 'bar', _trace: { traceparent: 'test-traceparent' } })
  })

  it('continues the producer trace from job metadata at dispatch', async () => {
    const result = await runJobInTrace('orders-process', { _trace: { traceparent: 'tp-123' } }, () =>
      Promise.resolve('done'),
    )
    expect(result).toBe('done')
    expect(remoteCarriers).toContainEqual({ traceparent: 'tp-123' })
    expect(spanNames).toContain('queue.orders-process')
  })

  it('runs jobs without a carrier under a fresh span (no crash)', async () => {
    const result = await runJobInTrace('orders-process', undefined, () => Promise.resolve(42))
    expect(result).toBe(42)
  })
})

/**
 * End-to-end through the REAL local strategy (file write + read + dispatch),
 * proving the headline acceptance criterion: a queued job continues the
 * enqueuing request's trace. This exercises the actual enqueue/dispatch wiring,
 * not just the helpers above.
 */
describe('queue trace propagation (real local strategy)', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-queue-trace-'))
  })

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  it('persists the trace carrier on enqueue and continues it on dispatch', async () => {
    const queue = createLocalQueue<{ orderId: string }>('orders-process', { baseDir })

    await queue.enqueue({ orderId: 'o-1' })

    // The carrier is written to the job's metadata — NOT the user payload.
    const stored = JSON.parse(
      fs.readFileSync(path.join(baseDir, 'orders-process', 'queue.json'), 'utf8'),
    ) as Array<{ payload: unknown; metadata?: Record<string, unknown> }>
    expect(stored[0].metadata).toEqual({ _trace: { traceparent: 'test-traceparent' } })
    expect(stored[0].payload).toEqual({ orderId: 'o-1' })

    let handlerRan = false
    await queue.process((job) => {
      handlerRan = true
      // The handler still sees only its payload; the carrier is invisible to it.
      expect(job.payload).toEqual({ orderId: 'o-1' })
    })

    expect(handlerRan).toBe(true)
    // The worker continued the producer's trace under a `queue.<name>` span.
    expect(remoteCarriers).toContainEqual({ traceparent: 'test-traceparent' })
    expect(spanNames).toContain('queue.orders-process')
  })
})
