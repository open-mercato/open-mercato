import { getTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

/**
 * Flushes telemetry before the CLI exits. Export is best-effort: an unreachable or
 * overloaded collector degrades to a warning and never changes the command's exit code.
 */
export async function flushTelemetry(
  runtime: TelemetryRuntime | undefined = getTelemetryRuntime(),
): Promise<void> {
  try {
    await runtime?.shutdown()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[telemetry] Flush on exit failed; telemetry from this run may be lost: ${reason}`)
  }
}
