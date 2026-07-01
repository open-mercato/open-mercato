import { inspect } from 'node:util'
import pino from 'pino'
import type { Attributes, Logger, LogLevel, LogRecord } from '../types'
import { readTelemetryEnv } from '../env'
import { getActiveProvider } from '../provider/registry'

const env = readTelemetryEnv()

/**
 * The default logger ALWAYS writes to stdout (it replaces `console.*` as the
 * baseline, so logs never vanish — even when telemetry is off). When an OTLP
 * backend is active it ALSO ships the record to that backend via
 * `provider.emitLog`. The backend adds remote export; it never gates stdout.
 *
 * Stdout format: single-line JSON by default (prod/CI, machine-parseable), or a
 * human-readable line in local dev (`TELEMETRY_LOG_PRETTY`, default on when
 * `NODE_ENV=development`) — no extra deps / no pino transport thread.
 */
const base = pino({
  level: env.logLevel,
  formatters: { level: (label) => ({ level: label }) },
})

const LEVEL_ORDER: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
const MIN_LEVEL_IDX = LEVEL_ORDER.indexOf(env.logLevel)
const CONSOLE_METHOD: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'debug', debug: 'debug', info: 'info', warn: 'warn', error: 'error', fatal: 'error',
}

/** Human-readable line for local dev: `12:34:56.789 INFO  message { attrs }`. */
function writePretty(level: LogLevel, message: string, obj: Record<string, unknown>): void {
  if (LEVEL_ORDER.indexOf(level) < MIN_LEVEL_IDX) return
  const time = new Date().toISOString().slice(11, 23)
  const hasAttrs = Object.keys(obj).length > 0
  // Colorize only for an interactive terminal — piped/captured stdout (CI,
  // Conductor) must stay free of ANSI escape codes.
  const suffix = hasAttrs ? ' ' + inspect(obj, { colors: !!process.stdout.isTTY, depth: 4, breakLength: 120 }) : ''
  console[CONSOLE_METHOD[level]](`${time} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`)
}

/** Low-level: write one record to stdout + the active backend. Single log path. */
export function writeRecord(record: LogRecord): void {
  const provider = getActiveProvider()
  const obj: Record<string, unknown> = { ...(record.attributes ?? {}) }
  // Correlate the stdout line with its trace (the OTLP log path correlates
  // automatically from active context; stdout needs the ids spelled out).
  const tc = provider.activeTraceContext()
  if (tc) {
    obj.trace_id = tc.traceId
    obj.span_id = tc.spanId
  }
  if (record.error) obj.err = record.error
  if (env.logPretty) writePretty(record.level, record.message, obj)
  else base[record.level](obj, record.message)
  // Gate the backend export by the same configured level as stdout, so
  // TELEMETRY_LOG_LEVEL controls remote volume/cost too — not just stdout.
  if (LEVEL_ORDER.indexOf(record.level) >= MIN_LEVEL_IDX) provider.emitLog(record)
}

function makeLogger(bindings: Attributes): Logger {
  const emit = (level: LogLevel, message: string, attributes?: Attributes) =>
    writeRecord({ level, message, attributes: attributes ? { ...bindings, ...attributes } : bindings })

  return {
    trace: (m, a) => emit('trace', m, a),
    debug: (m, a) => emit('debug', m, a),
    info: (m, a) => emit('info', m, a),
    warn: (m, a) => emit('warn', m, a),
    error: (m, a) => emit('error', m, a),
    fatal: (m, a) => emit('fatal', m, a),
    child: (childBindings) => makeLogger({ ...bindings, ...childBindings }),
  }
}

export const logger: Logger = makeLogger({})
