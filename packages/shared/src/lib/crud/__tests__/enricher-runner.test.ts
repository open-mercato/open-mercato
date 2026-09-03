import { createLogger } from '../../logger'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '../../telemetry/runtime'
import {
  applyResponseEnricherToRecord,
  applyResponseEnrichers,
} from '../enricher-runner'
import type {
  EnricherContext,
  EnricherRegistryEntry,
  ResponseEnricher,
} from '../response-enricher'

jest.mock('../../logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const logger = createLogger('shared').child({ component: 'umes' })
const loggerDebug = logger.debug as jest.Mock
const loggerWarn = logger.warn as jest.Mock
const loggerError = logger.error as jest.Mock

const context: EnricherContext = {
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  em: {},
  container: {},
}

function makeEntry(id: string): EnricherRegistryEntry {
  const enricher: ResponseEnricher<Record<string, unknown>, Record<string, unknown>> = {
    id,
    targetEntity: 'customers.person',
    enrichOne: async (record) => record,
    enrichMany: async (records) => records,
  }
  return { moduleId: 'test', enricher }
}

function mockNow(values: number[]): jest.SpyInstance<number, []> {
  let index = 0
  return jest.spyOn(Date, 'now').mockImplementation(() => {
    const value = values[index]
    if (value === undefined) {
      throw new Error('[internal] Missing mocked Date.now() value')
    }
    index += 1
    return value
  })
}

function makeRuntime(recordHistogram: jest.Mock): TelemetryRuntime {
  return {
    canUseGlobalTracePropagation: () => false,
    captureTraceContext: () => ({}),
    continueTrace: (_carrier, _name, fn) => fn(),
    recordHistogram,
    recordHttpDuration: () => {},
    reportError: () => {},
    shutdown: async () => {},
  }
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['Date'] })
  loggerDebug.mockClear()
  loggerWarn.mockClear()
  loggerError.mockClear()
  resetTelemetryRuntime()
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
  resetTelemetryRuntime()
})

describe('enricher performance reporting', () => {
  it('throttles terminal slow logs per enricher and reports suppressed observations', async () => {
    const entry = makeEntry('test.throttle')
    mockNow([0, 600, 1_000, 1_700, 2_000, 2_900, 31_000, 31_800])

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await applyResponseEnrichers([{ id: 'person-1' }], 'customers.person', context, [entry])
    }

    expect(loggerError).toHaveBeenCalledTimes(2)
    expect(loggerError).toHaveBeenNthCalledWith(1, 'Enricher exceeded slow threshold', {
      enricherId: 'test.throttle',
      elapsedMs: 600,
      thresholdMs: 500,
      suppressedCount: 0,
      maxElapsedMs: 600,
    })
    expect(loggerError).toHaveBeenNthCalledWith(2, 'Enricher exceeded slow threshold', {
      enricherId: 'test.throttle',
      elapsedMs: 800,
      thresholdMs: 500,
      suppressedCount: 2,
      maxElapsedMs: 900,
    })
    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it('routes the diagnostic threshold to debug and the terminal threshold to error', async () => {
    mockNow([0, 100, 1_000, 1_150, 2_000, 2_600])

    await applyResponseEnrichers(
      [{ id: 'person-1' }],
      'customers.person',
      context,
      [makeEntry('test.fast')],
    )
    await applyResponseEnrichers(
      [{ id: 'person-1' }],
      'customers.person',
      context,
      [makeEntry('test.diagnostic')],
    )
    await applyResponseEnrichers(
      [{ id: 'person-1' }],
      'customers.person',
      context,
      [makeEntry('test.terminal')],
    )

    expect(loggerDebug).toHaveBeenCalledTimes(1)
    expect(loggerDebug).toHaveBeenCalledWith('Enricher exceeded slow threshold', {
      enricherId: 'test.diagnostic',
      elapsedMs: 150,
      thresholdMs: 100,
    })
    expect(loggerError).toHaveBeenCalledTimes(1)
    expect(loggerError).toHaveBeenCalledWith(
      'Enricher exceeded slow threshold',
      expect.objectContaining({
        enricherId: 'test.terminal',
        elapsedMs: 600,
        thresholdMs: 500,
      }),
    )
    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it('emits list and record duration histograms only through an active runtime', async () => {
    const recordHistogram = jest.fn()
    registerTelemetryRuntime(makeRuntime(recordHistogram))
    mockNow([0, 250, 1_000, 1_050])

    await applyResponseEnrichers(
      [{ id: 'person-1' }],
      'customers.person',
      context,
      [makeEntry('test.metric-list')],
    )
    await applyResponseEnricherToRecord(
      { id: 'person-1' },
      'customers.person',
      context,
      [makeEntry('test.metric-record')],
    )

    expect(recordHistogram).toHaveBeenNthCalledWith(
      1,
      'om.enricher.duration',
      0.25,
      { 'enricher.id': 'test.metric-list' },
      's',
    )
    expect(recordHistogram).toHaveBeenNthCalledWith(
      2,
      'om.enricher.duration',
      0.05,
      { 'enricher.id': 'test.metric-record' },
      's',
    )
  })
})
