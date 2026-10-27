import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

export function reportAiAssistantError(
  error: unknown,
  code: string,
  attributes?: Record<string, string | number | boolean | undefined>,
): void {
  try {
    getTelemetryRuntime()?.reportError(error, {
      module: 'ai_assistant',
      code,
      ...(attributes ? { attributes } : {}),
    })
  } catch {
    return
  }
}
