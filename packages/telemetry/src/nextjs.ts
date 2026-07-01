/**
 * Next.js wiring helpers for `@open-mercato/telemetry`.
 *
 * These keep the app-side surface tiny: an app's `instrumentation.ts`,
 * `next.config.ts`, and API dispatcher consume these instead of copying
 * boilerplate that can drift. This module is import-safe from `next.config.ts`
 * (config-eval time) — it never statically imports `@opentelemetry/*` or the
 * pino-backed logger; the SDK is loaded dynamically by the provider only when a
 * backend is active, and `./init` (which constructs the logger) is dynamically
 * imported inside `registerTelemetryForNextjs`.
 */
import { histogram } from './facade/meter'

/**
 * Every `@opentelemetry/*` package the OTLP provider loads at runtime. Spread
 * into `next.config.ts` `serverExternalPackages` so the bundler leaves them as
 * real Node modules — the pg/undici auto-instrumentations monkey-patch the
 * underlying drivers, and a *partial* list re-bundles a patched module (the #1
 * cause of "telemetry silently emits nothing"). Exporting the full list from the
 * package makes it a single source of truth the app can never drift from.
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

/**
 * One-line telemetry bootstrap for a Next.js `instrumentation.ts`. Initializes
 * the active backend (no-op unless `TELEMETRY_BACKEND` is set), degrades to no
 * telemetry on init failure (never bubbles a rejection out of Next's
 * `register()`), and registers a best-effort flush on `SIGTERM`/`SIGINT`. Skips
 * the edge runtime — the OTEL NodeSDK is Node-only — so callers may import it
 * unconditionally, though gating the dynamic import on
 * `NEXT_RUNTIME === 'nodejs'` also keeps the SDK off the edge bundle.
 */
export async function registerTelemetryForNextjs(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return
  const { initTelemetry, shutdownTelemetry } = await import('./init')
  try {
    await initTelemetry()
  } catch (error) {
    console.warn('[telemetry] init from instrumentation failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }
  const flush = () => {
    void shutdownTelemetry()
  }
  process.once('SIGTERM', flush)
  process.once('SIGINT', flush)
}

/**
 * Emit the OpenTelemetry-standard HTTP server metric
 * `http.server.request.duration` (histogram, seconds) with semconv attributes.
 * `route` MUST be the low-cardinality route TEMPLATE (manifest path), never the
 * resolved pathname (which carries ids). No-op when telemetry is off.
 */
export function recordHttpDuration(method: string, route: string, status: number, startedAt: number): void {
  histogram(
    'http.server.request.duration',
    (Date.now() - startedAt) / 1000,
    {
      'http.request.method': method,
      'http.route': route,
      'http.response.status_code': status,
      'error.type': status >= 500 ? String(status) : undefined,
    },
    's',
  )
}
