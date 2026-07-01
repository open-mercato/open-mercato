/**
 * Node-only telemetry bootstrap. Imported by `instrumentation.ts` only when
 * `NEXT_RUNTIME === 'nodejs'`. Initializes the active backend from
 * `TELEMETRY_BACKEND` (no-op when unset) and flushes it on shutdown.
 */
import { initTelemetry, shutdownTelemetry } from '@open-mercato/telemetry'

export async function registerNode(): Promise<void> {
  // A telemetry init failure (bad endpoint, missing optional dep) must degrade
  // to no telemetry, never bubble a rejection out of Next's register().
  try {
    await initTelemetry()
  } catch (error) {
    console.warn('[telemetry] init from instrumentation failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  // Best-effort flush when the (long-running) server is asked to stop.
  const flush = () => {
    void shutdownTelemetry()
  }
  process.once('SIGTERM', flush)
  process.once('SIGINT', flush)
}
