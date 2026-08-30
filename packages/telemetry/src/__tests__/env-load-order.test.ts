import { getLoggerExtension, resetLoggerExtension } from '@open-mercato/shared/lib/logger'
import {
  getTelemetryRuntime,
  resetTelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { initTelemetry, resetTelemetryInit } from '../init'
import {
  getActiveProvider,
  registerProvider,
  resetActiveProvider,
} from '../provider/registry'
import { resetTelemetryEnvCache } from '../env'
import type { TelemetryProvider } from '../types'
import { NOOP_SPAN } from '../provider/noop-provider'

function provider(name = 'noop'): TelemetryProvider {
  return {
    name,
    supports: [],
    start: jest.fn(async () => {}),
    shutdown: jest.fn(async () => {}),
    runInSpan: (_name, _options, fn) => fn(NOOP_SPAN),
    activeSpan: () => undefined,
    activeTraceContext: () => undefined,
    inject: () => {},
    runInRemoteSpan: (_carrier, _name, _options, fn) => fn(NOOP_SPAN),
    emitLog: () => {},
    recordMetric: () => {},
  }
}

describe('telemetry explicit opt-in boundary', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    delete process.env.TELEMETRY_BACKEND
    resetTelemetryEnvCache()
    resetTelemetryInit()
    resetActiveProvider()
    resetLoggerExtension()
    resetTelemetryRuntime()
  })

  afterEach(() => {
    resetTelemetryInit()
    jest.useRealTimers()
  })

  it('does not resolve a custom provider or register runtime hooks while off', async () => {
    const customNoop = provider()
    registerProvider(customNoop)

    await initTelemetry()

    expect(customNoop.start).not.toHaveBeenCalled()
    expect(getActiveProvider().name).toBe('noop')
    expect(getLoggerExtension()).toBeUndefined()
    expect(getTelemetryRuntime()).toBeUndefined()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('can initialize after dotenv sets an enabled backend following an off call', async () => {
    const customConsole = provider('console')
    registerProvider(customConsole)

    await initTelemetry()
    process.env.TELEMETRY_BACKEND = 'console'
    await initTelemetry()

    expect(customConsole.start).toHaveBeenCalledTimes(1)
    expect(getActiveProvider()).toBe(customConsole)
    expect(getLoggerExtension()).toBeDefined()
    expect(getTelemetryRuntime()).toBeDefined()
    expect(jest.getTimerCount()).toBe(1)
  })

  it('initializes an explicitly registered custom backend', async () => {
    const customProvider = provider('custom-observability')
    registerProvider(customProvider)
    process.env.TELEMETRY_BACKEND = 'custom-observability'

    await initTelemetry()

    expect(customProvider.start).toHaveBeenCalledTimes(1)
    expect(getActiveProvider()).toBe(customProvider)
    expect(getLoggerExtension()).toBeDefined()
    expect(getTelemetryRuntime()).toBeDefined()
  })
})
