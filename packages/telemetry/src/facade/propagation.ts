import type { Span, SpanOptions, TraceCarrier } from '../types'
import { getActiveProvider } from '../provider/registry'
import { runWithSpan } from './context'

/**
 * Capture the active trace context into a fresh carrier, to embed in a queue job
 * or event payload (the queue/event bus expose no metadata channel — see the
 * telemetry spec's S5). Returns `{}` when telemetry is off.
 */
export function captureTraceContext(): TraceCarrier {
  const carrier: TraceCarrier = {}
  getActiveProvider().inject(carrier)
  return carrier
}

/**
 * Continue a trace on the consumer side (worker / subscriber): run `fn` inside a
 * new active span named `name`, parented to the context in `carrier`. The job's
 * spans (pg, etc.) then nest under the producer's trace as one waterfall. If
 * `carrier` is empty/undefined the span simply starts a fresh root.
 */
export function continueTrace<T>(
  carrier: TraceCarrier | undefined,
  name: string,
  fn: (span: Span) => T,
  options?: SpanOptions,
): T {
  return getActiveProvider().runInRemoteSpan(carrier ?? {}, name, options ?? {}, (span) =>
    runWithSpan(span, () => fn(span)),
  )
}
