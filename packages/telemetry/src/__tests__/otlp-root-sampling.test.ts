/**
 * Regression test for the bug `root` exists to fix.
 *
 * `ParentBasedSampler` only rolls the dice at a trace's ROOT; every descendant
 * inherits that one decision. A sync/backfill job inherits the trace of the
 * request that triggered it, so below ratio 1.0 an entire multi-day run is a
 * coin flip taken hours earlier — lose it and the run emits nothing at all, for
 * its whole life, with no way to intervene from outside.
 *
 * Ratio 0 makes that deterministic here: a span nested under a sampled parent is
 * still recorded (inheritance), while a `root: true` span takes a FRESH decision
 * and is dropped. A run of rooted batches therefore never rides on one flip.
 *
 * Its own file because the sampling ratio is read once at `provider.start()` and
 * NodeSDK installs process-global tracer state.
 */
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

import { OtlpProvider } from '../provider/otlp-provider'
import { setActiveProvider, resetActiveProvider } from '../provider/registry'
import { resetTelemetryEnvCache } from '../env'
import { withSpan, continueTrace } from '../index'

const spanExporter = new InMemorySpanExporter()
let provider: OtlpProvider

/** A remote parent already marked sampled (trace-flags `01`). */
const SAMPLED_REMOTE_CARRIER = {
  traceparent: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`,
}

/** The span processor hands off to the exporter off the microtask queue. */
const settleExports = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeAll(async () => {
  process.env.TELEMETRY_BACKEND = 'otlp'
  process.env.TELEMETRY_SAMPLING_RATIO = '0'
  resetTelemetryEnvCache()
  provider = new OtlpProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    instrumentations: [],
  })
  await provider.start()
  setActiveProvider(provider)
  // The first span after NodeSDK.start() can be dropped while the global tracer
  // provider finishes installing — warm up, settle a tick, then reset.
  withSpan('warmup', () => undefined)
  await new Promise((resolve) => setTimeout(resolve, 10))
  spanExporter.reset()
})

afterAll(async () => {
  await provider.shutdown()
  resetActiveProvider()
  delete process.env.TELEMETRY_BACKEND
  delete process.env.TELEMETRY_SAMPLING_RATIO
  resetTelemetryEnvCache()
})

describe('root spans take their own sampling decision', () => {
  it('drops a rooted span at ratio 0 while a nested span still inherits the parent decision', async () => {
    continueTrace(SAMPLED_REMOTE_CARRIER, 'queue.job', () => {
      withSpan('nested.batch', () => undefined)
      withSpan('rooted.batch', () => undefined, { root: true })
    })
    await settleExports()

    const names = spanExporter.getFinishedSpans().map((span) => span.name)
    // Inherited from the sampled remote parent — the status quo for anything
    // that nests under the triggering request.
    expect(names).toContain('queue.job')
    expect(names).toContain('nested.batch')
    // Re-sampled from scratch against the ratio, so the trigger's decision no
    // longer governs it.
    expect(names).not.toContain('rooted.batch')
  })
})
