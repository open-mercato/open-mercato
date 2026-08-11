/**
 * Server-only half of browser RUM: resolves the client configuration and the
 * collector coordinates from the telemetry env the host already sets
 * (`TELEMETRY_BACKEND`, `OTEL_EXPORTER_OTLP_*`), so enabling RUM is one flag and
 * no new endpoint plumbing.
 *
 * Import from `@open-mercato/telemetry/browser/server` — NOT from
 * `@open-mercato/telemetry/browser`, which is the client-safe entry. The split is
 * the point: `resolveCollectorHeaders()` returns the collector credential, which
 * must never be reachable from a client bundle. The guard below turns a wrong
 * import into an immediate, loud failure instead of a silent leak.
 *
 * Resolved at request time in the backend layout (`force-dynamic`) and passed to
 * the client as props — deliberately NOT `NEXT_PUBLIC_*`, which would bake the
 * values into the build and require a rebuild to toggle.
 */
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readTelemetryEnv } from '../env'
import { BROWSER_TRACES_PATH, type BrowserTelemetryConfig } from './config'

if (typeof window !== 'undefined') {
  throw new Error('[internal] @open-mercato/telemetry/browser/server is server-only; import @open-mercato/telemetry/browser instead')
}

const logger = createLogger('telemetry').child({ component: 'browser-config' })

/** `deployment.environment=dev,foo=bar` → `dev`. */
function readDeploymentEnvironment(raw: string | undefined): string | null {
  if (!raw) return null
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    if (pair.slice(0, idx).trim() !== 'deployment.environment') continue
    const value = pair.slice(idx + 1).trim()
    if (value) return value
  }
  return null
}

function readSamplingRatio(raw: string | undefined): number {
  if (!raw) return 1
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(1, Math.max(0, parsed))
}

let warnedAboutTraceContinuity = false

/**
 * Browser spans stitch to their server spans only when the server continues the
 * inbound trace, which is exactly what `TELEMETRY_TRUST_INBOUND_TRACE` gates. RUM
 * without it still works — it just yields two disconnected traces per page, which
 * looks like a bug and is the single most likely misconfiguration, so say it once
 * per process rather than let an operator discover it in the trace view.
 */
function warnWhenTracesCannotStitch(): void {
  if (warnedAboutTraceContinuity) return
  // Same reader the provider's propagator consults, so the warning can never
  // disagree with the behaviour it describes.
  if (readTelemetryEnv().trustInboundTrace) return
  warnedAboutTraceContinuity = true
  logger.warn('telemetry.browser.trace_continuity_disabled', {
    detail:
      'Browser RUM is enabled but TELEMETRY_TRUST_INBOUND_TRACE is not true, so browser spans and their server spans will land in separate traces. Set it to true when the app is only reachable through trusted infrastructure.',
  })
}

/** Test seam: the warn-once latch is process-wide, which a second test case would otherwise miss. */
export function resetBrowserTelemetryWarnings(): void {
  warnedAboutTraceContinuity = false
}

/**
 * Returns `null` when browser telemetry is off — which is the default
 * everywhere, including local. Requires an active server telemetry backend
 * *and* an explicit opt-in: RUM without a reachable collector is pure overhead
 * in the client bundle.
 */
export function resolveBrowserTelemetryConfig(): BrowserTelemetryConfig | null {
  if (!parseBooleanWithDefault(process.env.TELEMETRY_BROWSER_ENABLED, false)) return null
  if (!isTelemetryBackendEnabled()) return null
  if (!resolveCollectorTracesUrl()) return null

  warnWhenTracesCannotStitch()

  const serviceName =
    process.env.TELEMETRY_BROWSER_SERVICE_NAME?.trim() ||
    `${process.env.OTEL_SERVICE_NAME?.trim() || 'open-mercato'}-browser`

  return {
    endpoint: BROWSER_TRACES_PATH,
    serviceName,
    environment: readDeploymentEnvironment(process.env.OTEL_RESOURCE_ATTRIBUTES),
    samplingRatio: readSamplingRatio(process.env.TELEMETRY_BROWSER_SAMPLING_RATIO),
  }
}

/**
 * Where the proxy forwards to. Per the OTLP spec a signal-specific endpoint is
 * used verbatim, while the generic one gets `/v1/traces` appended.
 */
export function resolveCollectorTracesUrl(): string | null {
  const signal = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
  if (signal) return signal
  const generic = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (!generic) return null
  return `${generic.replace(/\/+$/, '')}/v1/traces`
}

/**
 * `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <b64>,key=value` → header record.
 * Split on the FIRST `=` only: base64 credentials routinely end in `=` padding.
 */
export function resolveCollectorHeaders(): Record<string, string> {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS?.trim()
  if (!raw) return {}
  const headers: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=')
    if (idx <= 0) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (key && value) headers[key] = value
  }
  return headers
}
