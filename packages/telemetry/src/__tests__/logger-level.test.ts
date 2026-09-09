import {
  createLogger,
  resetLogLevelCache,
  resetLoggerExtension,
  resetLoggerRegistry,
} from '@open-mercato/shared/lib/logger'
import { resetTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { initTelemetry, resetTelemetryInit } from '../init'
import { registerProvider, resetActiveProvider } from '../provider/registry'
import { resetTelemetryEnvCache } from '../env'
import { NOOP_SPAN } from '../provider/noop-provider'
import type { LogRecord, TelemetryProvider } from '../types'

function recordingProvider(logs: LogRecord[]): TelemetryProvider {
  return {
    name: 'console',
    supports: ['logs'],
    async start() {},
    async shutdown() {},
    runInSpan: (_name, _options, fn) => fn(NOOP_SPAN),
    activeSpan: () => undefined,
    activeTraceContext: () => undefined,
    inject: () => {},
    runInRemoteSpan: (_carrier, _name, _options, fn) => fn(NOOP_SPAN),
    emitLog: (record) => logs.push(record),
    recordMetric: () => {},
  }
}

describe('unified logger telemetry export', () => {
  beforeEach(() => {
    process.env.TELEMETRY_BACKEND = 'console'
    process.env.OM_LOG_LEVEL = 'warn'
    resetLogLevelCache()
    resetLoggerRegistry()
    resetLoggerExtension()
    resetTelemetryRuntime()
    resetTelemetryInit()
    resetActiveProvider()
    resetTelemetryEnvCache()
  })

  afterEach(() => {
    delete process.env.TELEMETRY_BACKEND
    delete process.env.OM_LOG_LEVEL
  })

  it('uses the shared level gate for local and remote output', async () => {
    const logs: LogRecord[] = []
    registerProvider(recordingProvider(logs))
    await initTelemetry()
    const logger = createLogger('orders')

    logger.debug('quiet')
    logger.info('quiet')
    logger.warn('visible')
    logger.error('failed', { err: new Error('boom') })

    expect(logs.map((record) => record.level)).toEqual(['warn', 'error'])
    expect(logs.map((record) => record.message)).toEqual(['visible', 'failed'])
    expect(logs[1].error?.message).toBe('boom')
    expect(logs[1].attributes?.['logger.name']).toBe('orders')
  })
})
