/**
 * The browser-RUM contract shared by both halves of the feature: the shape the
 * server resolves (`browser/server.ts`) and the shape the client component
 * consumes (`browser/BrowserTelemetry.tsx`).
 *
 * Deliberately dependency-free and env-free so it can sit in a client bundle.
 * Everything that reads `process.env` lives in `browser/server.ts`, which is a
 * server-only module and is never reachable from the `/browser` entry.
 */

/** Same-origin path the browser exporter posts to; served by the `telemetry` module's API route. */
export const BROWSER_TRACES_PATH = '/api/telemetry/browser-traces'

export type BrowserTelemetryConfig = {
  /** Same-origin OTLP endpoint (the proxy route). */
  endpoint: string
  serviceName: string
  /** `deployment.environment` — kept as a plain attribute name to match existing server spans. */
  environment: string | null
  samplingRatio: number
}
