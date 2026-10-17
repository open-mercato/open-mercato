jest.mock('@open-mercato/queue', () => ({
  createQueue: jest.fn(() => ({
    enqueue: jest.fn(),
    clear: jest.fn(),
    close: jest.fn(),
  })),
}))

import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'

const { createEventBus } = require('../bus')

function registerReportingRuntime(reportError: TelemetryRuntime['reportError']): void {
  registerTelemetryRuntime({
    canUseGlobalTracePropagation: () => false,
    captureTraceContext: () => undefined,
    continueTrace: (_carrier, _name, fn) => fn(),
    recordHttpDuration: () => {},
    reportError,
    shutdown: async () => {},
  })
}

describe('event handler error propagation', () => {
  const originalConsoleError = console.error

  beforeEach(() => {
    console.error = jest.fn()
  })

  afterEach(() => {
    console.error = originalConsoleError
    resetTelemetryRuntime()
  })

  it('keeps handler failures non-blocking by default', async () => {
    const bus = createEventBus({ resolve: () => undefined })
    bus.on('demo.failed', async () => {
      throw new Error('boom')
    })

    await expect(bus.emit('demo.failed', {})).resolves.toBeUndefined()
  })

  it('rejects the emit when rethrowHandlerErrors is enabled', async () => {
    const bus = createEventBus({ resolve: () => undefined })
    bus.on('demo.failed', async () => {
      throw new Error('boom')
    })

    await expect(bus.emit('demo.failed', {}, { rethrowHandlerErrors: true })).rejects.toThrow('boom')
  })

  it('reports a swallowed handler failure to telemetry with a stable code', async () => {
    const reportError = jest.fn()
    registerReportingRuntime(reportError)
    const failure = new Error('boom')
    const bus = createEventBus({ resolve: () => undefined })
    bus.on('demo.failed', async () => {
      throw failure
    }, { id: 'demo:failing-subscriber', persistent: true })

    await expect(bus.emit('demo.failed', {})).resolves.toBeUndefined()

    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(failure, {
      module: 'events',
      code: 'events.handler_failed',
      attributes: { event: 'demo.failed', subscriber: 'demo:failing-subscriber', persistent: true },
    })
  })

  it('leaves reporting to the caller when the handler failure is rethrown', async () => {
    const reportError = jest.fn()
    registerReportingRuntime(reportError)
    const bus = createEventBus({ resolve: () => undefined })
    bus.on('demo.failed', async () => {
      throw new Error('boom')
    })

    await expect(bus.emit('demo.failed', {}, { rethrowHandlerErrors: true })).rejects.toThrow('boom')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('keeps delivering to later subscribers when the telemetry bridge itself throws', async () => {
    registerReportingRuntime(() => {
      throw new Error('telemetry down')
    })
    const delivered: string[] = []
    const bus = createEventBus({ resolve: () => undefined })
    bus.on('demo.failed', async () => {
      throw new Error('boom')
    })
    bus.on('demo.failed', async () => {
      delivered.push('second')
    })

    await expect(bus.emit('demo.failed', {})).resolves.toBeUndefined()
    expect(delivered).toEqual(['second'])
  })
})
