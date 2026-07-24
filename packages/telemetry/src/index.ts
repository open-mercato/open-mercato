/**
 * Public facade for the telemetry package. Import from `@open-mercato/telemetry`.
 *
 * Vendor-neutral by construction — nothing here imports `@opentelemetry/*`;
 * only `provider/otlp-provider.ts` does, and it is loaded dynamically.
 */
export { withSpan, currentSpan, setAttributes } from './facade/tracer'
export { counter, histogram, gauge } from './facade/meter'
export { reportError } from './facade/report-error'
export type { ReportErrorContext } from './facade/report-error'
export { captureTraceContext, continueTrace } from './facade/propagation'
export { initTelemetry, shutdownTelemetry } from './init'
export { registerProvider } from './provider/registry'

export type {
  Span,
  SpanKind,
  SpanOptions,
  TelemetryProvider,
  TelemetrySignal,
  TelemetryBackendName,
  LogRecord,
  LogLevel,
  MetricKind,
  MetricPoint,
  Attributes,
  AttributeValue,
  TraceCarrier,
  TraceContext,
} from './types'
