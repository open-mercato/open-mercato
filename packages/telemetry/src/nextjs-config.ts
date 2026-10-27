/**
 * OpenTelemetry packages that must remain real Node modules so runtime
 * instrumentations can patch their targets. This config-only entrypoint has no
 * telemetry runtime imports and is safe to evaluate from `next.config.ts`.
 */
export const telemetryServerExternalPackages = [
  '@opentelemetry/api',
  '@opentelemetry/api-logs',
  '@opentelemetry/core',
  '@opentelemetry/sdk-node',
  '@opentelemetry/sdk-trace-node',
  '@opentelemetry/sdk-logs',
  '@opentelemetry/sdk-metrics',
  '@opentelemetry/resources',
  '@opentelemetry/semantic-conventions',
  '@opentelemetry/instrumentation',
  '@opentelemetry/instrumentation-pg',
  '@opentelemetry/instrumentation-undici',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-logs-otlp-http',
  '@opentelemetry/exporter-metrics-otlp-http',
] as const
