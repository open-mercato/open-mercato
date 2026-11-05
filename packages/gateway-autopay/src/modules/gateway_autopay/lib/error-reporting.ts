import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

export type AutopayErrorCode =
  | 'gateway_autopay.setup_preset_failed'
  | 'gateway_autopay.health_check_failed'
  | 'gateway_autopay.cli_configure_failed'
  | 'gateway_autopay.launch_failed'
  | 'gateway_autopay.return_failed'

export function reportAutopayError(error: unknown, code: AutopayErrorCode): void {
  try {
    getTelemetryRuntime()?.reportError(error, { module: 'gateway_autopay', code })
  } catch {
    // A failing telemetry sink must never break tenant setup, health probes or the CLI.
  }
}
