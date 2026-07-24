/**
 * The ONLY file in this package that imports `@opentelemetry/*`. Loaded via
 * dynamic `import()` from `init.ts` (so the heavy SDK never loads when telemetry
 * is off), and the OTEL packages live in `optionalDependencies`.
 *
 * Serves any OTLP backend — the endpoint + headers come from the standard
 * `OTEL_EXPORTER_OTLP_*` env vars, read by the exporters directly.
 */
import {
  trace,
  metrics,
  context,
  isSpanContextValid,
  defaultTextMapGetter,
  defaultTextMapSetter,
  SpanStatusCode,
  SpanKind as OtelSpanKind,
  type Span as OtelApiSpan,
  type TextMapPropagator,
  type Counter,
  type Histogram,
  type Gauge,
} from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { NodeSDK } from '@opentelemetry/sdk-node'
import type { Instrumentation } from '@opentelemetry/instrumentation'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { BatchLogRecordProcessor, type LogRecordProcessor } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader, type IMetricReader } from '@opentelemetry/sdk-metrics'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'

import type {
  Attributes,
  AttributeValue,
  LogLevel,
  LogRecord,
  MetricPoint,
  Span,
  SpanKind,
  SpanOptions,
  TelemetryProvider,
  TelemetrySignal,
  TraceCarrier,
  TraceContext,
} from '../types'
import { readTelemetryEnv } from '../env'
import { redactAttributes, redactPii } from '../facade/redact'
import { serializeError } from '../facade/serialize'
import { runSpan } from './run-span'

const TRACER_NAME = 'open-mercato'

/**
 * Queue/event trace propagation rides a dedicated W3C propagator on the payload
 * `_trace` carrier — deliberately NOT the global propagator below.
 */
const queuePropagator = new W3CTraceContextPropagator()

const W3C_TRACEPARENT = 'traceparent'
const W3C_TRACESTATE = 'tracestate'
// Backup headers that mirror the W3C context but a proxy/LB won't rewrite.
const BACKUP_TRACEPARENT = 'x-original-traceparent'
const BACKUP_TRACESTATE = 'x-original-tracestate'

/**
 * Global propagator: standard W3C plus a backup copy
 * (`x-original-traceparent`), with explicit inbound trust.
 *
 * The problem: a load balancer (e.g. GCP's) reads the inbound `traceparent`,
 * creates its own span, and **rewrites** `traceparent` to point at that span —
 * which our backend never sees. With plain W3C extraction every request becomes a
 * child of that unexported span: no request is a root, and root-span / trace-group
 * views come up empty.
 *
 * The fix (the industry "backup header" pattern): on inject we also write
 * `x-original-traceparent`, which the LB leaves untouched. A backup header is
 * still caller-controlled at an HTTP boundary, so its mere
 * presence is not proof that one of our services created it. Extraction ignores
 * both standard and backup headers by default.
 *
 * `TELEMETRY_TRUST_INBOUND_TRACE=true` enables both extraction paths for a
 * deployment behind a trusted upstream. Our dedicated queue/event carrier is
 * unaffected — it uses `queuePropagator` directly, not this global one.
 */
const backupHeaderPropagator: TextMapPropagator = {
  inject(ctx, carrier, setter) {
    // Inject into a plain temp carrier so we can mirror the values regardless of
    // the real carrier's setter shape, then copy both standard + backup headers.
    const tmp: Record<string, string> = {}
    queuePropagator.inject(ctx, tmp, defaultTextMapSetter)
    for (const [key, value] of Object.entries(tmp)) setter.set(carrier, key, value)
    if (tmp[W3C_TRACEPARENT]) setter.set(carrier, BACKUP_TRACEPARENT, tmp[W3C_TRACEPARENT])
    if (tmp[W3C_TRACESTATE]) setter.set(carrier, BACKUP_TRACESTATE, tmp[W3C_TRACESTATE])
  },
  extract(ctx, carrier, getter) {
    // Both the standard and backup headers are caller-controlled at an HTTP
    // boundary. Trust neither unless the deployment explicitly opts in.
    if (!readTelemetryEnv().trustInboundTrace) return ctx
    const first = (value: string | string[] | undefined): string | undefined =>
      Array.isArray(value) ? value[0] : value
    const backupTraceparent = first(getter.get(carrier, BACKUP_TRACEPARENT))
    if (backupTraceparent) {
      const backupCarrier: Record<string, string> = { [W3C_TRACEPARENT]: backupTraceparent }
      const backupTracestate = first(getter.get(carrier, BACKUP_TRACESTATE))
      if (backupTracestate) backupCarrier[W3C_TRACESTATE] = backupTracestate
      return queuePropagator.extract(ctx, backupCarrier, defaultTextMapGetter)
    }
    return queuePropagator.extract(ctx, carrier, getter)
  },
  fields: () => [...queuePropagator.fields(), BACKUP_TRACEPARENT, BACKUP_TRACESTATE],
}

function cleanAttributes(attributes?: Attributes): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {}
  if (!attributes) return out
  for (const [key, value] of Object.entries(redactAttributes(attributes))) {
    if (value !== undefined) out[key] = value
  }
  return out
}

const SPAN_KIND: Record<SpanKind, OtelSpanKind> = {
  internal: OtelSpanKind.INTERNAL,
  server: OtelSpanKind.SERVER,
  client: OtelSpanKind.CLIENT,
  producer: OtelSpanKind.PRODUCER,
  consumer: OtelSpanKind.CONSUMER,
}

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
}

/** Adapts an OTEL span to the vendor-neutral `Span` interface. */
class OtelSpan implements Span {
  constructor(private readonly span: OtelApiSpan) {}
  setAttribute(key: string, value: AttributeValue): void {
    const redacted = cleanAttributes({ [key]: value })[key]
    if (redacted !== undefined) this.span.setAttribute(key, redacted)
  }
  setAttributes(attributes: Attributes): void {
    this.span.setAttributes(cleanAttributes(attributes))
  }
  recordException(error: unknown): void {
    // Redact message + stack before they leave the process (Privacy): the auto
    // record-on-throw path (run-span) and reportError both pass raw errors here.
    this.span.recordException(serializeError(error))
  }
  setStatus(status: 'ok' | 'error', message?: string): void {
    this.span.setStatus({
      code: status === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      message: message ? redactPii(message) : undefined,
    })
  }
  end(): void {
    this.span.end()
  }
}

/**
 * Test seam: override the SDK's exporters/instrumentations so tests can use
 * in-memory exporters (deterministic, no network) instead of the OTLP defaults.
 * Production passes nothing — the OTLP defaults apply.
 */
export type OtlpProviderOptions = {
  spanProcessors?: SpanProcessor[]
  logRecordProcessors?: LogRecordProcessor[]
  metricReaders?: IMetricReader[]
  instrumentations?: Instrumentation[]
}

/**
 * PII guard (telemetry spec Privacy / R12). The single source of truth for pg
 * instrumentation config: `enhancedDatabaseReporting: false` means bound SQL
 * parameter VALUES are NOT captured — only the statement shape ($1, $2). User
 * data lives in those params, so this must never be flipped on. Asserted by a
 * regression test.
 */
export const PG_INSTRUMENTATION_OPTIONS = { enhancedDatabaseReporting: false } as const

export class OtlpProvider implements TelemetryProvider {
  /** The configured backend name (signoz | newrelic | otlp) — all OTLP, vendor differs only by endpoint. */
  readonly name: string
  readonly supports: readonly TelemetrySignal[] = ['traces', 'metrics', 'logs', 'errors']

  private sdk: NodeSDK | undefined
  private readonly instruments = new Map<string, Counter | Histogram | Gauge>()

  constructor(private readonly options: OtlpProviderOptions = {}, name = 'otlp') {
    this.name = name
  }

  async start(): Promise<void> {
    if (this.sdk) return
    const env = readTelemetryEnv()

    this.sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: env.serviceName }),
      // Global propagation roots requests by default. Both standard and backup
      // inbound headers are honored only when TELEMETRY_TRUST_INBOUND_TRACE is
      // explicitly enabled behind trusted infrastructure.
      textMapPropagator: backupHeaderPropagator,
      // Parent-based so child spans follow the trace's sampling decision; root
      // spans sample at the configured ratio.
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(env.samplingRatio) }),
      spanProcessors: this.options.spanProcessors ?? [new BatchSpanProcessor(new OTLPTraceExporter())],
      logRecordProcessors: this.options.logRecordProcessors ?? [new BatchLogRecordProcessor(new OTLPLogExporter())],
      metricReaders: this.options.metricReaders ?? [
        new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
      ],
      instrumentations: this.options.instrumentations ?? [
        new PgInstrumentation(PG_INSTRUMENTATION_OPTIONS),
        new UndiciInstrumentation(),
      ],
    })
    this.sdk.start()
  }

  async shutdown(): Promise<void> {
    if (!this.sdk) return
    await this.sdk.shutdown()
    this.sdk = undefined
  }

  runInSpan<T>(name: string, options: SpanOptions, fn: (span: Span) => T): T {
    const tracer = trace.getTracer(TRACER_NAME)
    return tracer.startActiveSpan(
      name,
      { kind: options.kind ? SPAN_KIND[options.kind] : undefined, attributes: cleanAttributes(options.attributes) },
      (otelSpan) => runSpan(new OtelSpan(otelSpan), fn),
    )
  }

  activeSpan(): Span | undefined {
    const active = trace.getActiveSpan()
    return active ? new OtelSpan(active) : undefined
  }

  activeTraceContext(): TraceContext | undefined {
    const ctx = trace.getActiveSpan()?.spanContext()
    if (!ctx || !isSpanContextValid(ctx)) return undefined
    return { traceId: ctx.traceId, spanId: ctx.spanId }
  }

  inject(carrier: TraceCarrier): void {
    queuePropagator.inject(context.active(), carrier, defaultTextMapSetter)
  }

  runInRemoteSpan<T>(carrier: TraceCarrier, name: string, options: SpanOptions, fn: (span: Span) => T): T {
    const parent = queuePropagator.extract(context.active(), carrier, defaultTextMapGetter)
    const tracer = trace.getTracer(TRACER_NAME)
    return context.with(parent, () =>
      tracer.startActiveSpan(
        name,
        { kind: options.kind ? SPAN_KIND[options.kind] : undefined, attributes: cleanAttributes(options.attributes) },
        (otelSpan) => runSpan(new OtelSpan(otelSpan), fn),
      ),
    )
  }

  emitLog(record: LogRecord): void {
    const attributes: Record<string, AttributeValue> = cleanAttributes(record.attributes)
    if (record.error) {
      attributes['exception.type'] = redactPii(record.error.name)
      attributes['exception.message'] = redactPii(record.error.message)
      if (record.error.stack) attributes['exception.stacktrace'] = redactPii(record.error.stack)
    }
    logs.getLogger(TRACER_NAME).emit({
      severityNumber: SEVERITY[record.level],
      severityText: record.level,
      body: redactPii(record.message),
      attributes,
    })
  }

  recordMetric(point: MetricPoint): void {
    const labels = cleanAttributes(point.labels)
    const instrument = this.getInstrument(point)
    if (point.kind === 'counter') (instrument as Counter).add(point.value, labels)
    else (instrument as Histogram | Gauge).record(point.value, labels)
  }

  private getInstrument(point: MetricPoint): Counter | Histogram | Gauge {
    const key = `${point.kind}:${point.name}`
    let instrument = this.instruments.get(key)
    if (!instrument) {
      const meter = metrics.getMeter(TRACER_NAME)
      const opts = point.unit ? { unit: point.unit } : undefined
      instrument =
        point.kind === 'counter'
          ? meter.createCounter(point.name, opts)
          : point.kind === 'histogram'
            ? meter.createHistogram(point.name, opts)
            : meter.createGauge(point.name, opts)
      this.instruments.set(key, instrument)
    }
    return instrument
  }
}
