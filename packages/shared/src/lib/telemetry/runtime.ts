export type TelemetryTraceCarrier = Record<string, string>

export type TelemetryRuntime = {
  /**
   * True only when the active SDK may safely use the process-global W3C
   * propagator for cross-boundary extraction.
   */
  canUseGlobalTracePropagation(): boolean
  captureTraceContext(): TelemetryTraceCarrier
  continueTrace<T>(
    carrier: TelemetryTraceCarrier | undefined,
    name: string,
    fn: () => T,
    options?: { kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer' },
  ): T
  recordHttpDuration(method: string, route: string, status: number, startedAt: number): void
  reportError(
    error: unknown,
    context?: {
      module?: string
      attributes?: Record<string, string | number | boolean | undefined>
    },
  ): void
  shutdown(): Promise<void>
}

const GLOBAL_KEY = Symbol.for('@open-mercato/shared.telemetryRuntime')
const ENABLED_BACKENDS = new Set(['console', 'signoz', 'newrelic', 'otlp'])

type TelemetryRuntimeStore = {
  active?: TelemetryRuntime
}

function store(): TelemetryRuntimeStore {
  const globalStore = globalThis as unknown as Record<symbol, TelemetryRuntimeStore | undefined>
  let current = globalStore[GLOBAL_KEY]
  if (!current) {
    current = {}
    globalStore[GLOBAL_KEY] = current
  }
  return current
}

/**
 * This check is intentionally owned by shared code so hosts can decide whether
 * to dynamically import the telemetry package without evaluating that package.
 */
export function isTelemetryBackendEnabled(raw?: string): boolean {
  const value = raw ?? (
    typeof process === 'undefined'
      ? undefined
      : process.env.TELEMETRY_BACKEND
  )
  return ENABLED_BACKENDS.has((value ?? '').trim().toLowerCase())
}

export function registerTelemetryRuntime(runtime: TelemetryRuntime): () => void {
  store().active = runtime
  return () => {
    const current = store()
    if (current.active === runtime) current.active = undefined
  }
}

export function getTelemetryRuntime(): TelemetryRuntime | undefined {
  return store().active
}

/** Test-only: clear the process-wide telemetry bridge. */
export function resetTelemetryRuntime(): void {
  store().active = undefined
}
