import type { LogBindings, Logger } from './index'
import { parseBooleanToken } from '../boolean'
import { isLevelEnabled, type LogLevel } from './level'
import { formatBindings } from './transport.console'
import { OM_LOG_DESTINATION_ENV, isStderrDestinationToken } from './transport.server'

export const OM_LOG_PRETTY_ENV = 'OM_LOG_PRETTY'

type EnvSource = Record<string, string | undefined>

function readProcessEnv(): EnvSource {
  return typeof process === 'undefined' ? {} : process.env
}

/** Resolve pretty mode from `OM_LOG_PRETTY`, defaulting to on outside production. */
export function resolvePrettyMode(env: EnvSource = readProcessEnv()): boolean {
  const parsed = parseBooleanToken(env[OM_LOG_PRETTY_ENV])
  if (parsed !== null) return parsed
  return env.NODE_ENV !== 'production'
}

let cachedPrettyMode: boolean | null = null

export function isPrettyModeEnabled(): boolean {
  if (cachedPrettyMode === null) cachedPrettyMode = resolvePrettyMode()
  return cachedPrettyMode
}

/** Internal: clear the memoized pretty mode so tests can vary `OM_LOG_PRETTY`. */
export function resetLogPrettyCache(): void {
  cachedPrettyMode = null
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
}

const ANSI_RESET = '\x1b[0m'
const ANSI_DIM = '\x1b[2m'

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: ANSI_DIM,
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}

type WritableLogStream = { write(chunk: string): unknown; isTTY?: boolean }

function resolveStream(): WritableLogStream {
  const useStderr = isStderrDestinationToken(readProcessEnv()[OM_LOG_DESTINATION_ENV])
  return useStderr ? process.stderr : process.stdout
}

function formatTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const millis = String(date.getMilliseconds()).padStart(3, '0')
  return `${hours}:${minutes}:${seconds}.${millis}`
}

export function createPrettyLogger(namespace: string, bindings: LogBindings = {}): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogBindings): void => {
    if (!isLevelEnabled(level)) return
    const stream = resolveStream()
    const { err, ...rest } = { ...bindings, ...fields }
    let scope = namespace
    if (typeof rest.component === 'string' && rest.component) {
      scope = `${namespace}:${rest.component}`
      delete rest.component
    }
    const tail = formatBindings(err instanceof Error || err === undefined ? rest : { ...rest, err })
    const colored = stream.isTTY === true
    const timestamp = formatTimestamp(new Date())
    const timestampPart = colored ? `${ANSI_DIM}${timestamp}${ANSI_RESET}` : timestamp
    const label = LEVEL_LABELS[level]
    const levelPart = colored ? `${LEVEL_COLORS[level]}${label}${ANSI_RESET}` : label
    let line = `${timestampPart} ${levelPart} [${scope}] ${msg}`
    if (tail) line += ` ${tail}`
    if (err instanceof Error) line += `\n${err.stack ?? err.message}`
    stream.write(`${line}\n`)
  }
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (childBindings) => createPrettyLogger(namespace, { ...bindings, ...childBindings }),
  }
}
