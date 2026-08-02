export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export const OM_LOG_LEVEL_ENV = 'OM_LOG_LEVEL'

export const LOG_LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const VALID_LEVEL_TOKENS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error'])

type EnvSource = Record<string, string | undefined>

function readProcessEnv(): EnvSource {
  return typeof process === 'undefined' ? {} : process.env
}

function defaultLevelFor(env: EnvSource): LogLevel {
  return env.NODE_ENV === 'production' ? 'info' : 'debug'
}

/** Resolve the effective log level from `OM_LOG_LEVEL`, falling back on `NODE_ENV`. */
export function resolveLevel(env: EnvSource = readProcessEnv()): LogLevel {
  const raw = env[OM_LOG_LEVEL_ENV]
  if (typeof raw !== 'string' || !raw.trim()) return defaultLevelFor(env)
  const normalized = raw.trim().toLowerCase()
  if (VALID_LEVEL_TOKENS.has(normalized)) return normalized as LogLevel
  const fallback = defaultLevelFor(env)
  console.warn(`[logger] Unrecognized ${OM_LOG_LEVEL_ENV} value "${raw}"; falling back to "${fallback}"`)
  return fallback
}

let cachedLevel: LogLevel | null = null

/** Resolve the effective level once, for callers that want to gate expensive work. */
export function getLogLevel(): LogLevel {
  if (cachedLevel === null) cachedLevel = resolveLevel()
  return cachedLevel
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LOG_LEVEL_WEIGHTS[level] >= LOG_LEVEL_WEIGHTS[getLogLevel()]
}

/** Internal: clear the memoized level so tests can vary `OM_LOG_LEVEL`. */
export function resetLogLevelCache(): void {
  cachedLevel = null
}
