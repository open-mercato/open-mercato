import { setActiveProvider, resetActiveProvider } from '../provider/registry'
import type { Logger, LogRecord, MetricPoint, Span, SpanOptions, TelemetryProvider, TraceCarrier } from '../types'

/**
 * Guards that TELEMETRY_LOG_LEVEL gates the BACKEND export, not just stdout —
 * a below-level record (e.g. info when the level is warn) must not reach
 * `provider.emitLog`, or an OTLP backend silently ships filtered-out logs.
 *
 * The logger binds its level at import time, so each case re-imports it under a
 * fresh env via `jest.isolateModules`.
 */
function recordingProvider(logs: LogRecord[]): TelemetryProvider {
  return {
    name: 'noop',
    supports: ['logs'],
    async start() {},
    async shutdown() {},
    runInSpan<T>(_n: string, _o: SpanOptions, fn: (s: Span) => T): T {
      return fn({ setAttribute() {}, setAttributes() {}, recordException() {}, setStatus() {}, end() {} })
    },
    activeSpan: () => undefined,
    activeTraceContext: () => undefined,
    inject: () => {},
    runInRemoteSpan<T>(_c: TraceCarrier, _n: string, _o: SpanOptions, fn: (s: Span) => T): T {
      return fn({ setAttribute() {}, setAttributes() {}, recordException() {}, setStatus() {}, end() {} })
    },
    emitLog: (record: LogRecord) => logs.push(record),
    recordMetric: (_p: MetricPoint) => {},
  }
}

function loadLoggerAtLevel(level: string | undefined, logs: LogRecord[]): Logger {
  if (level === undefined) delete process.env.TELEMETRY_LOG_LEVEL
  else process.env.TELEMETRY_LOG_LEVEL = level
  setActiveProvider(recordingProvider(logs))
  let logger!: Logger
  jest.isolateModules(() => {
    logger = require('../facade/logger').logger
  })
  return logger
}

const SAVED = { ...process.env }

afterEach(() => {
  process.env = { ...SAVED }
  resetActiveProvider()
})

describe('logger backend-export level gating', () => {
  it('drops records below the configured level from the backend export', () => {
    const logs: LogRecord[] = []
    const logger = loadLoggerAtLevel('warn', logs)

    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')

    expect(logs.map((r) => r.level)).toEqual(['warn', 'error'])
  })

  it('exports info and above under the default level', () => {
    const logs: LogRecord[] = []
    const logger = loadLoggerAtLevel(undefined, logs)

    logger.debug('d')
    logger.info('i')
    logger.error('e')

    expect(logs.map((r) => r.level)).toEqual(['info', 'error'])
  })
})
