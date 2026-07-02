import type {
  LogRecord,
  MetricPoint,
  Span,
  SpanOptions,
  TelemetryProvider,
  TelemetrySignal,
  TraceCarrier,
  TraceContext,
} from '../types'

/** A span that does nothing — used when telemetry is off. */
export const NOOP_SPAN: Span = {
  setAttribute() {},
  setAttributes() {},
  recordException() {},
  setStatus() {},
  end() {},
}

/**
 * The default backend: a hard no-op. `runInSpan` still runs `fn` (so app logic
 * is unaffected); everything else is a cheap return. The heavy OTEL SDK is
 * never imported on this path.
 */
export class NoopProvider implements TelemetryProvider {
  readonly name = 'noop'
  readonly supports: readonly TelemetrySignal[] = []

  async start(): Promise<void> {}
  async shutdown(): Promise<void> {}

  runInSpan<T>(_name: string, _options: SpanOptions, fn: (span: Span) => T): T {
    return fn(NOOP_SPAN)
  }

  activeSpan(): Span | undefined {
    return undefined
  }

  activeTraceContext(): TraceContext | undefined {
    return undefined
  }

  inject(_carrier: TraceCarrier): void {}

  runInRemoteSpan<T>(_carrier: TraceCarrier, _name: string, _options: SpanOptions, fn: (span: Span) => T): T {
    return fn(NOOP_SPAN)
  }

  emitLog(_record: LogRecord): void {}
  recordMetric(_point: MetricPoint): void {}
}
