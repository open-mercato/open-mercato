export const DEFAULT_PROBE_INTERVAL_MS = 5000
export const DEFAULT_PROBE_TIMEOUT_MS = 1500
export const DEFAULT_PROBE_FAILURE_THRESHOLD = 3
export const DEFAULT_PROBE_RECOVERY_THRESHOLD = 2

export class DevRuntimeConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DevRuntimeConfigError'
  }
}

function readRawEnv(env, key) {
  const raw = env?.[key]
  if (typeof raw !== 'string') return ''
  return raw.trim()
}

function parseBoundedInteger(env, key, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = readRawEnv(env, key)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new DevRuntimeConfigError(`${key} must be an integer between ${min} and ${max}; received "${raw}".`)
  }
  return parsed
}

function parseEnabledFlag(env, key, fallback) {
  const raw = readRawEnv(env, key).toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(raw)) return true
  if (['0', 'false', 'off', 'no', 'disabled'].includes(raw)) return false
  throw new DevRuntimeConfigError(`${key} must be a boolean flag; received "${raw}".`)
}

export function resolveDevRuntimeMode(env = process.env) {
  const raw = readRawEnv(env, 'OM_DEV_RUNTIME_MODE').toLowerCase()
  if (!raw) return 'direct'
  if (raw === 'direct' || raw === 'proxy') return raw
  throw new DevRuntimeConfigError(`OM_DEV_RUNTIME_MODE must be "direct" or "proxy"; received "${raw}".`)
}

export function resolveUpstreamPort(env = process.env, publicPort = null) {
  const raw = readRawEnv(env, 'OM_DEV_UPSTREAM_PORT')
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new DevRuntimeConfigError(`OM_DEV_UPSTREAM_PORT must be an integer between 1 and 65535; received "${raw}".`)
  }
  if (Number.isInteger(publicPort) && parsed === publicPort) {
    throw new DevRuntimeConfigError(`OM_DEV_UPSTREAM_PORT (${parsed}) must not equal the public application port.`)
  }
  return parsed
}

export function resolveProbeConfig(env = process.env) {
  const intervalMs = parseBoundedInteger(env, 'OM_DEV_RUNTIME_PROBE_INTERVAL_MS', DEFAULT_PROBE_INTERVAL_MS, { min: 250, max: 600_000 })
  const timeoutMs = parseBoundedInteger(env, 'OM_DEV_RUNTIME_PROBE_TIMEOUT_MS', DEFAULT_PROBE_TIMEOUT_MS, { min: 100, max: 600_000 })
  if (timeoutMs >= intervalMs) {
    throw new DevRuntimeConfigError(`OM_DEV_RUNTIME_PROBE_TIMEOUT_MS (${timeoutMs}) must be less than OM_DEV_RUNTIME_PROBE_INTERVAL_MS (${intervalMs}).`)
  }
  return {
    intervalMs,
    timeoutMs,
    failureThreshold: parseBoundedInteger(env, 'OM_DEV_RUNTIME_PROBE_FAILURE_THRESHOLD', DEFAULT_PROBE_FAILURE_THRESHOLD, { min: 1, max: 100 }),
    recoveryThreshold: parseBoundedInteger(env, 'OM_DEV_RUNTIME_PROBE_RECOVERY_THRESHOLD', DEFAULT_PROBE_RECOVERY_THRESHOLD, { min: 1, max: 100 }),
  }
}

// Diagnostics follow the dev splash: enabled when the splash is enabled and the
// process is not a CI run, unless explicitly overridden.
export function resolveDiagnosticsConfig(env = process.env, { splashEnabled = true } = {}) {
  const defaultEnabled = splashEnabled && env?.CI !== 'true'
  const diagnosticsEnabled = parseEnabledFlag(env, 'OM_DEV_RUNTIME_DIAGNOSTICS', defaultEnabled)
  return {
    diagnosticsEnabled,
    bannerEnabled: parseEnabledFlag(env, 'OM_DEV_RUNTIME_BANNER', diagnosticsEnabled) && diagnosticsEnabled,
  }
}

export function resolveDevRuntimeConfig(env = process.env, { splashEnabled = true, publicPort = null } = {}) {
  return {
    mode: resolveDevRuntimeMode(env),
    upstreamPort: resolveUpstreamPort(env, publicPort),
    probe: resolveProbeConfig(env),
    ...resolveDiagnosticsConfig(env, { splashEnabled }),
  }
}
