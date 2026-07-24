/**
 * Next.js wiring helpers for `@open-mercato/telemetry`.
 *
 * Runtime helpers for an enabled Next.js telemetry integration. Build-time
 * config belongs in `@open-mercato/telemetry/nextjs-config`, which has no
 * runtime imports.
 */
import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'
export { telemetryServerExternalPackages } from './nextjs-config'
export { recordHttpDuration } from './facade/http'

const logger = createLogger('telemetry')

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
  if (!isTelemetryBackendEnabled()) return
  const { initTelemetry, shutdownTelemetry } = await import('./init')
  try {
    await initTelemetry()
  } catch (error) {
    logger.warn('Init from Next.js instrumentation failed', { err: error })
    return
  }
  // A signal listener suppresses Node's default termination, so after the
  // best-effort flush the handler re-raises the signal. `once` has already
  // removed this listener by then, so the re-raise falls through to the default
  // terminate (or to another component's own handler, e.g. Next's).
  const flush = (signal: NodeJS.Signals) => {
    void shutdownTelemetry()
      .catch(() => {})
      .finally(() => {
        process.kill(process.pid, signal)
      })
  }
  process.once('SIGTERM', flush)
  process.once('SIGINT', flush)
}
