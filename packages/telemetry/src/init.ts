import type { TelemetryBackendName, TelemetryProvider } from './types'
import { isOtlpBackend, readTelemetryEnv, resetTelemetryEnvCache } from './env'
import { ConsoleProvider } from './provider/console-provider'
import {
  getRegisteredProvider,
  clearActiveProvider,
  setActiveProvider,
} from './provider/registry'
import {
  registerTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { registerTelemetryLogger } from './facade/logger-bridge'
import { captureTraceContext, continueTrace } from './facade/propagation'
import { recordHttpDuration } from './facade/http'
import { reportError } from './facade/report-error'

let initialized = false
let activeProvider: TelemetryProvider | undefined
let disposeLoggerExtension: (() => void) | undefined
let disposeRuntime: (() => void) | undefined

const logger = createLogger('telemetry')

/**
 * One-shot bootstrap, invoked from `apps/mercato/instrumentation.ts` (web) and,
 * for cross-boundary propagation, from the queue/worker bootstrap. Resolves the
 * backend from `TELEMETRY_BACKEND`, starts it, and installs it as the active
 * provider. Idempotent and safe to call when telemetry is off (defaults to
 * no-op).
 */
export async function initTelemetry(): Promise<void> {
  if (initialized) return

  // Drop any env snapshot memoized BEFORE the host loaded its `.env` (the CLI
  // binary imports this package before dotenv runs) so init resolves the backend
  // from the actual, fully-loaded environment.
  resetTelemetryEnvCache()
  const env = readTelemetryEnv()
  // Explicit off is absolute: do not resolve custom providers, register hooks,
  // or install process-wide bridges when the backend is unset/noop/unknown.
  if (!env.enabled) return

  const provider = await resolveProvider(env.backend)

  // Only flag initialized AFTER start() succeeds — a throw here must leave
  // telemetry re-initializable, not stuck flagged-on with an unstarted provider.
  await provider.start()
  setActiveProvider(provider)
  activeProvider = provider
  disposeLoggerExtension = registerTelemetryLogger(provider)
  disposeRuntime = registerTelemetryRuntime(createRuntime(provider))
  initialized = true

  logger.info('Telemetry initialized', {
    backend: provider.name,
    samplingRatio: env.samplingRatio,
  })
}

async function resolveProvider(backend: TelemetryBackendName): Promise<TelemetryProvider> {
  const registered = getRegisteredProvider(backend)
  if (registered) return registered

  if (backend === 'console') return new ConsoleProvider()
  // signoz | newrelic | otlp — same OTLP provider, vendor differs only by endpoint.
  if (isOtlpBackend(backend)) return await loadOtlpProvider(backend)
  throw new Error(`Unsupported enabled telemetry backend: ${backend}`)
}

/**
 * Dynamically load the OTLP provider so `@opentelemetry/*` (optionalDependencies)
 * is imported only when an OTLP backend is selected. Falls back to console if
 * the OTEL packages are absent rather than crashing the app.
 */
async function loadOtlpProvider(backend: TelemetryBackendName): Promise<TelemetryProvider> {
  try {
    const mod = await import('./provider/otlp-provider')
    return new mod.OtlpProvider({}, backend)
  } catch (err) {
    logger.warn('OTLP provider unavailable; falling back to console', {
      reason: err instanceof Error ? err.message : String(err),
    })
    return new ConsoleProvider()
  }
}

/** Flush + tear down the active backend (shutdown hook / `after()`). */
export async function shutdownTelemetry(): Promise<void> {
  const provider = activeProvider
  activeProvider = undefined
  initialized = false
  disposeLoggerExtension?.()
  disposeLoggerExtension = undefined
  disposeRuntime?.()
  disposeRuntime = undefined
  clearActiveProvider()
  if (provider) await provider.shutdown()
}

function createRuntime(provider: TelemetryProvider): TelemetryRuntime {
  return {
    canUseGlobalTracePropagation: () =>
      isOtlpBackend(provider.name as TelemetryBackendName)
      && readTelemetryEnv().trustInboundTrace,
    captureTraceContext,
    continueTrace: (carrier, name, fn, options) =>
      continueTrace(carrier, name, () => fn(), options),
    recordHttpDuration,
    reportError,
    shutdown: shutdownTelemetry,
  }
}

/** Test-only: allow re-init in jest. */
export function resetTelemetryInit(): void {
  initialized = false
  activeProvider = undefined
  disposeLoggerExtension?.()
  disposeLoggerExtension = undefined
  disposeRuntime?.()
  disposeRuntime = undefined
}
