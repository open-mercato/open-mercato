/**
 * Public, vendor-neutral telemetry contract.
 *
 * Nothing in this package's facade may import any `@opentelemetry/*` package —
 * only `provider/otlp-provider.ts` does, and it is loaded dynamically so the SDK
 * never resolves when telemetry is off.
 */

/** Signal categories a provider may support. Unsupported signals no-op. */
export type TelemetrySignal = 'traces' | 'metrics' | 'logs' | 'errors'

/** Attribute primitive values allowed on spans/logs/metrics (low-cardinality, no PII). */
export type AttributeValue = string | number | boolean
export type Attributes = Record<string, AttributeValue | undefined>

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** A structured log record routed through the active provider. */
export type LogRecord = {
  level: LogLevel
  message: string
  attributes?: Attributes
  /** Serialized error (stack only, no PII payloads). */
  error?: { name: string; message: string; stack?: string }
  /** Epoch milliseconds; defaults to emit time. */
  time?: number
}

/** A single metric observation. */
export type MetricKind = 'counter' | 'histogram' | 'gauge'
export type MetricPoint = {
  kind: MetricKind
  name: string
  value: number
  /** Low-cardinality labels only (never tenant/org/user IDs — those are span attributes). */
  labels?: Attributes
  /** UCUM unit (e.g. `s`, `By`); set once per metric name at instrument creation. */
  unit?: string
}

/** Options when starting a span. */
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer'
export type SpanOptions = {
  kind?: SpanKind
  attributes?: Attributes
}

/**
 * Vendor-neutral handle to an active span. Backed by a real OTEL span under the
 * OTLP provider, or a cheap shim under noop/console.
 */
export interface Span {
  setAttribute(key: string, value: AttributeValue): void
  setAttributes(attributes: Attributes): void
  recordException(error: unknown): void
  setStatus(status: 'ok' | 'error', message?: string): void
  end(): void
}

/** The active trace + span ids, for correlating structured logs with traces. */
export type TraceContext = { traceId: string; spanId: string }

/**
 * A telemetry backend.
 *
 * Tracing uses a DELEGATION model — the provider OWNS span creation and runs
 * `fn` inside the span's context (`runInSpan`). This is required so manually
 * created spans and OTEL auto-instrumentation spans (pg/http) share one trace;
 * a detached "finished span" sink cannot propagate context. Logs/metrics stay
 * sink-style.
 */
export interface TelemetryProvider {
  readonly name: string
  readonly supports: readonly TelemetrySignal[]
  /** Initialize the backend (SDK start, exporters). Idempotent. */
  start(): Promise<void>
  /** Flush and tear down. Idempotent. */
  shutdown(): Promise<void>
  /** Run `fn` inside a new active span. Records exceptions + duration automatically. */
  runInSpan<T>(name: string, options: SpanOptions, fn: (span: Span) => T): T
  /** The currently active span in this async context, if any. */
  activeSpan(): Span | undefined
  /** The active trace/span ids (for log correlation), or undefined if none is active. */
  activeTraceContext(): TraceContext | undefined
  /** Write the active trace context into `carrier` (W3C propagation). */
  inject(carrier: TraceCarrier): void
  /** Extract a parent trace context from `carrier`, then run `fn` in a new active span under it. */
  runInRemoteSpan<T>(carrier: TraceCarrier, name: string, options: SpanOptions, fn: (span: Span) => T): T
  /** Emit a structured log record (no-op if `logs` unsupported). */
  emitLog(record: LogRecord): void
  /** Record a metric observation (no-op if `metrics` unsupported). */
  recordMetric(point: MetricPoint): void
}

/**
 * Carrier for cross-boundary trace context (W3C `traceparent`/`tracestate`).
 * Embedded in queue job payloads / event payloads to link a producer's trace to
 * the consumer's spans (the queue/event bus expose no metadata channel).
 */
export type TraceCarrier = Record<string, string>

/**
 * Resolved configuration for the active backend. `signoz`, `newrelic`, and the
 * generic `otlp` all select the same OTLP provider — they differ only by the
 * standard `OTEL_EXPORTER_OTLP_ENDPOINT`/`_HEADERS` that point it at a vendor.
 * Modern New Relic ingests OTLP directly, so it needs no bespoke exporter.
 */
export type TelemetryBackendName = 'noop' | 'console' | 'signoz' | 'newrelic' | 'otlp'
