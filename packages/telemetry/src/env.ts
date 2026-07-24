import type { TelemetryBackendName } from './types'

const BACKENDS: readonly TelemetryBackendName[] = ['noop', 'console', 'signoz', 'newrelic', 'otlp']

/** Backend names that resolve to the OTLP provider (vendor differs only by endpoint). */
const OTLP_BACKENDS: readonly TelemetryBackendName[] = ['signoz', 'newrelic', 'otlp']
export function isOtlpBackend(name: TelemetryBackendName): boolean {
  return (OTLP_BACKENDS as readonly string[]).includes(name)
}

export type TelemetryEnv = {
  /** Active backend. Unset/unknown → 'noop' (off). */
  backend: TelemetryBackendName
  /** True unless backend is 'noop'. */
  enabled: boolean
  /** 0.0–1.0 trace sampling ratio. */
  samplingRatio: number
  /**
   * Continue the inbound HTTP trace (standard W3C extract) instead of rooting
   * per request. Default false. Set true only when embedded behind a trusted
   * upstream whose trace should continue.
   */
  trustInboundTrace: boolean
  serviceName: string
  /** OTLP endpoint (provider reads standard OTEL vars; surfaced here for diagnostics). */
  otlpEndpoint?: string
}

function parseBackend(raw: string | undefined): TelemetryBackendName {
  const v = (raw ?? '').trim().toLowerCase()
  return (BACKENDS as readonly string[]).includes(v) ? (v as TelemetryBackendName) : 'noop'
}

function parseSampling(raw: string | undefined, isProd: boolean): number {
  const n = Number.parseFloat((raw ?? '').trim())
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n
  return isProd ? 0.1 : 1.0
}

/** Parse a boolean env flag; unset/unknown → `fallback`. */
function parseBool(raw: string | undefined, fallback: boolean): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return fallback
}

let cached: TelemetryEnv | undefined

export function readTelemetryEnv(): TelemetryEnv {
  if (cached) return cached
  const isProd = process.env.NODE_ENV === 'production'
  const backend = parseBackend(process.env.TELEMETRY_BACKEND)
  cached = {
    backend,
    enabled: backend !== 'noop',
    samplingRatio: parseSampling(process.env.TELEMETRY_SAMPLING_RATIO, isProd),
    trustInboundTrace: parseBool(process.env.TELEMETRY_TRUST_INBOUND_TRACE, false),
    serviceName: process.env.OTEL_SERVICE_NAME?.trim() || 'open-mercato',
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || undefined,
  }
  return cached
}

/**
 * Reset the memoized env snapshot. Called by `initTelemetry()` so init always
 * resolves from the fully-loaded environment (a host may import this package
 * before its `.env` is loaded — the CLI binary does), and by jest between tests.
 */
export function resetTelemetryEnvCache(): void {
  cached = undefined
}
