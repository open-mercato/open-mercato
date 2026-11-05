import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

type ErrorReportContext = { module: string; code: string }

/** Telemetry is observability only: a missing or throwing runtime never changes control flow. */
export function reportErrorSafely(error: unknown, context: ErrorReportContext): void {
  try {
    getTelemetryRuntime()?.reportError(error, context)
  } catch {
    return
  }
}
