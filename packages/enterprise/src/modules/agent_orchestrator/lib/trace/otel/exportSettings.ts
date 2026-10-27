import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { otelExportSettingsSchema, type OtelExportSettings } from '../../../data/validators'

const logger = createLogger('agent_orchestrator').child({ component: 'otel-export-settings' })

export const OTEL_EXPORT_CONFIG_MODULE = 'agent_orchestrator'
export const OTEL_EXPORT_CONFIG_NAME = 'otel_export'

export const OTEL_EXPORT_ENV = {
  enabled: 'OM_AGENT_OTEL_EXPORT',
  endpoint: 'OM_AGENT_OTEL_EXPORT_ENDPOINT',
  headers: 'OM_AGENT_OTEL_EXPORT_HEADERS',
  protocol: 'OM_AGENT_OTEL_EXPORT_PROTOCOL',
  content: 'OM_AGENT_OTEL_EXPORT_CONTENT',
  delayMs: 'OM_AGENT_OTEL_EXPORT_DELAY_MS',
  serviceName: 'OM_AGENT_OTEL_SERVICE_NAME',
  sources: 'OM_AGENT_OTEL_EXPORT_SOURCES',
  traceUrlTemplate: 'OM_AGENT_OTEL_TRACE_URL_TEMPLATE',
  platformTracesEndpoint: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  platformEndpoint: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  platformHeaders: 'OTEL_EXPORTER_OTLP_HEADERS',
} as const

export const OTEL_EXPORT_SUPPORTED_PROTOCOL = 'http/json'
export const OTEL_EXPORT_DEFAULT_DELAY_MS = 30_000
export const OTEL_EXPORT_MAX_DELAY_MS = 24 * 60 * 60 * 1000
export const OTEL_EXPORT_DEFAULT_SERVICE_NAME = 'open-mercato-agents'
export const OTEL_EXPORT_DEFAULT_SOURCES: readonly string[] = ['runtime', 'eval']
export const OTEL_EXPORT_TRACES_PATH = '/v1/traces'

export const DEFAULT_OTEL_EXPORT_SETTINGS: OtelExportSettings = otelExportSettingsSchema.parse({})

type EnvLike = Record<string, string | undefined>

export type OtelExportDeploymentConfig = {
  enabled: boolean
  switchOn: boolean
  protocol: string
  protocolSupported: boolean
  endpoint: string | null
  headers: Record<string, string>
  contentAllowed: boolean
  delayMs: number
  serviceName: string
  sources: string[]
  traceUrlTemplate: string | null
}

const warnedEnvKeys = new Set<string>()

function warnOnce(key: string, message: string, details: Record<string, unknown>): void {
  if (warnedEnvKeys.has(key)) return
  warnedEnvKeys.add(key)
  logger.warn(message, details)
}

function readTrimmed(env: EnvLike, name: string): string | null {
  const raw = env[name]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const HEADER_VALUE_FORBIDDEN_RE = /[\r\n\0]/

function decodeHeaderPart(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * Parses the W3C OTLP header list format (`k=v,k2=v2`, URL-encoded values).
 * Malformed pairs are skipped; header values are never logged.
 */
export function parseOtlpHeaders(raw: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  if (typeof raw !== 'string') return headers
  for (const pair of raw.split(',')) {
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const name = decodeHeaderPart(pair.slice(0, separator).trim())
    const value = decodeHeaderPart(pair.slice(separator + 1).trim())
    if (name === null || value === null) continue
    if (!HEADER_NAME_RE.test(name)) continue
    if (HEADER_VALUE_FORBIDDEN_RE.test(value)) continue
    headers[name] = value
  }
  return headers
}

function normalizeEndpoint(raw: string, variable: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    warnOnce(`endpoint-invalid:${variable}`, 'otel export endpoint is not a valid URL; export disabled', {
      variable,
    })
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    warnOnce(`endpoint-scheme:${variable}`, 'otel export endpoint must use http or https; export disabled', {
      variable,
    })
    return null
  }
  return parsed.toString()
}

function joinTracesPath(base: string): string {
  return `${base.replace(/\/+$/, '')}${OTEL_EXPORT_TRACES_PATH}`
}

/**
 * The OTLP traces endpoint: `OM_AGENT_OTEL_EXPORT_ENDPOINT`, else the platform
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, else `OTEL_EXPORTER_OTLP_ENDPOINT` +
 * `/v1/traces`. `null` when none is set or the chosen value is not an http(s) URL.
 */
export function resolveOtelExportEndpoint(env: EnvLike = process.env): string | null {
  const explicit = readTrimmed(env, OTEL_EXPORT_ENV.endpoint)
  if (explicit) return normalizeEndpoint(explicit, OTEL_EXPORT_ENV.endpoint)
  const traces = readTrimmed(env, OTEL_EXPORT_ENV.platformTracesEndpoint)
  if (traces) return normalizeEndpoint(traces, OTEL_EXPORT_ENV.platformTracesEndpoint)
  const base = readTrimmed(env, OTEL_EXPORT_ENV.platformEndpoint)
  if (base) return normalizeEndpoint(joinTracesPath(base), OTEL_EXPORT_ENV.platformEndpoint)
  return null
}

function readDelayMs(env: EnvLike): number {
  const raw = readTrimmed(env, OTEL_EXPORT_ENV.delayMs)
  if (raw === null) return OTEL_EXPORT_DEFAULT_DELAY_MS
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed > OTEL_EXPORT_MAX_DELAY_MS) {
    warnOnce(`delay:${raw}`, 'unrecognized otel export delay; using the default', {
      variable: OTEL_EXPORT_ENV.delayMs,
      fallback: OTEL_EXPORT_DEFAULT_DELAY_MS,
    })
    return OTEL_EXPORT_DEFAULT_DELAY_MS
  }
  return parsed
}

function readSources(env: EnvLike): string[] {
  const raw = readTrimmed(env, OTEL_EXPORT_ENV.sources)
  if (raw === null) return [...OTEL_EXPORT_DEFAULT_SOURCES]
  const sources = Array.from(
    new Set(
      raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry !== ''),
    ),
  )
  return sources.length > 0 ? sources : [...OTEL_EXPORT_DEFAULT_SOURCES]
}

function readSwitch(env: EnvLike): boolean {
  const raw = readTrimmed(env, OTEL_EXPORT_ENV.enabled)
  if (raw === null) return false
  const parsed = parseBooleanToken(raw)
  if (parsed === null) {
    warnOnce(`switch:${raw}`, 'unrecognized otel export switch; export disabled', {
      variable: OTEL_EXPORT_ENV.enabled,
    })
    return false
  }
  return parsed
}

function readContentAllowed(env: EnvLike): boolean {
  const raw = readTrimmed(env, OTEL_EXPORT_ENV.content)
  if (raw === null) return false
  const normalized = raw.toLowerCase()
  if (normalized === 'allow') return true
  if (normalized !== 'deny') {
    warnOnce(`content:${raw}`, 'unrecognized otel export content mode; content denied', {
      variable: OTEL_EXPORT_ENV.content,
    })
  }
  return false
}

/**
 * Deployment-level OTel export configuration from the environment. `enabled`
 * requires the master switch, the supported protocol (`http/json`; anything
 * else disables export with a one-time warning) and a usable endpoint. The
 * endpoint and headers stay server-side and are never logged.
 */
export function resolveOtelExportDeployment(env: EnvLike = process.env): OtelExportDeploymentConfig {
  const switchOn = readSwitch(env)
  const protocol = (readTrimmed(env, OTEL_EXPORT_ENV.protocol) ?? OTEL_EXPORT_SUPPORTED_PROTOCOL).toLowerCase()
  const protocolSupported = protocol === OTEL_EXPORT_SUPPORTED_PROTOCOL
  if (switchOn && !protocolSupported) {
    warnOnce(`protocol:${protocol}`, 'unsupported otel export protocol; export disabled', {
      variable: OTEL_EXPORT_ENV.protocol,
      supported: OTEL_EXPORT_SUPPORTED_PROTOCOL,
    })
  }
  const endpoint = resolveOtelExportEndpoint(env)
  const headersRaw =
    readTrimmed(env, OTEL_EXPORT_ENV.headers) ?? readTrimmed(env, OTEL_EXPORT_ENV.platformHeaders)
  return {
    enabled: switchOn && protocolSupported && endpoint !== null,
    switchOn,
    protocol,
    protocolSupported,
    endpoint,
    headers: parseOtlpHeaders(headersRaw),
    contentAllowed: readContentAllowed(env),
    delayMs: readDelayMs(env),
    serviceName: readTrimmed(env, OTEL_EXPORT_ENV.serviceName) ?? OTEL_EXPORT_DEFAULT_SERVICE_NAME,
    sources: readSources(env),
    traceUrlTemplate: readTrimmed(env, OTEL_EXPORT_ENV.traceUrlTemplate),
  }
}

type ModuleConfigServiceLike = {
  getRecord(
    moduleId: string,
    name: string,
    scope?: { tenantId?: string | null },
  ): Promise<{ value: unknown; source?: string; updatedAt?: string } | null>
}

function resolveModuleConfig(container: AwilixContainer): ModuleConfigServiceLike | null {
  try {
    return container.resolve('moduleConfigService') as ModuleConfigServiceLike
  } catch {
    return null
  }
}

export type OtelExportSettingsSource = 'tenant' | 'default'

export type StoredOtelExportSettings = {
  settings: OtelExportSettings
  source: OtelExportSettingsSource
  updatedAt: string | null
}

/**
 * The tenant's stored OTel export settings and the row's `updatedAt` (the
 * optimistic-lock version; `null` when the tenant has no row of its own).
 * Fails closed: every failure arm yields the disabled default.
 */
export async function readOtelExportSettings(
  container: AwilixContainer,
  tenantId: string | null,
): Promise<StoredOtelExportSettings> {
  const fallback = (updatedAt: string | null = null): StoredOtelExportSettings => ({
    settings: DEFAULT_OTEL_EXPORT_SETTINGS,
    source: 'default',
    updatedAt,
  })
  const service = resolveModuleConfig(container)
  if (!service) return fallback()
  try {
    const record = await service.getRecord(OTEL_EXPORT_CONFIG_MODULE, OTEL_EXPORT_CONFIG_NAME, { tenantId })
    if (!record) return fallback()
    const updatedAt =
      record.source !== 'instance' && typeof record.updatedAt === 'string' ? record.updatedAt : null
    if (record.value === null || record.value === undefined) return fallback(updatedAt)
    const parsed = otelExportSettingsSchema.safeParse(record.value)
    if (!parsed.success) {
      logger.warn('stored otel export settings are malformed; export disabled for the tenant', { tenantId })
      return fallback(updatedAt)
    }
    return { settings: parsed.data, source: 'tenant', updatedAt }
  } catch (error) {
    logger.warn('otel export settings unreadable; export disabled for the tenant', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    return fallback()
  }
}

export type IsExportEnabledForInput = {
  deployment: OtelExportDeploymentConfig
  tenant: OtelExportSettings
  agentId: string
  runSource: string | null | undefined
}

/**
 * Effective export gate: deployment enabled ∧ tenant enabled ∧ (allowlist
 * absent ∨ agent listed) ∧ run source listed in `OM_AGENT_OTEL_EXPORT_SOURCES`.
 */
export function isExportEnabledFor(input: IsExportEnabledForInput): boolean {
  if (!input.deployment.enabled) return false
  if (!input.tenant.enabled) return false
  const allowlist = input.tenant.agentAllowlist
  if (allowlist && !allowlist.includes(input.agentId)) return false
  const runSource = (input.runSource ?? '').toLowerCase()
  return runSource !== '' && input.deployment.sources.includes(runSource)
}
