import { createLogger } from '../../logger'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '../../telemetry/runtime'
import { registerResponseEnrichers } from '../enricher-registry'
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

function makeCriticalEnrichingEntry(id: string): EnricherRegistryEntry {
  const entry = makeEntry(id)
  entry.enricher.critical = true
  entry.enricher.enrichMany = async (records) =>
    records.map((record) => ({ ...record, enriched: true }))
  entry.enricher.enrichOne = async (record) => ({ ...record, enriched: true })
  return entry
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

  it('preserves successful critical enrichment and throttles the warning per enricher when histogram recording fails', async () => {
    const entry = makeCriticalEnrichingEntry('test.metric-failure')
    const otherEntry = makeCriticalEnrichingEntry('test.metric-failure-other')
    const telemetryError = new Error('[internal] Telemetry provider failed')
    const recordHistogram = jest.fn(() => {
      throw telemetryError
    })
    registerTelemetryRuntime(makeRuntime(recordHistogram))
    mockNow([0, 25, 1_000, 1_010, 2_000, 2_020, 31_000, 31_030])

    const listResult = await applyResponseEnrichers(
      [{ id: 'person-1' }],
      'customers.person',
      context,
      [entry],
    )
    const recordResult = await applyResponseEnricherToRecord(
      { id: 'person-1' },
      'customers.person',
      context,
      [entry],
    )

    expect(listResult).toEqual({
      items: [{ id: 'person-1', enriched: true }],
      _meta: { enrichedBy: ['test.metric-failure'] },
    })
    expect(recordResult).toEqual({
      record: { id: 'person-1', enriched: true },
      _meta: { enrichedBy: ['test.metric-failure'] },
    })
    expect(recordHistogram).toHaveBeenCalledTimes(2)
    expect(loggerWarn).toHaveBeenCalledTimes(1)
    expect(loggerWarn).toHaveBeenCalledWith('Enricher duration metric recording failed', {
      enricherId: 'test.metric-failure',
      metric: 'om.enricher.duration',
      err: telemetryError,
    })

    const otherRecordResult = await applyResponseEnricherToRecord(
      { id: 'person-1' },
      'customers.person',
      context,
      [otherEntry],
    )

    expect(otherRecordResult).toEqual({
      record: { id: 'person-1', enriched: true },
      _meta: { enrichedBy: ['test.metric-failure-other'] },
    })
    expect(loggerWarn).toHaveBeenCalledTimes(2)
    expect(loggerWarn).toHaveBeenNthCalledWith(2, 'Enricher duration metric recording failed', {
      enricherId: 'test.metric-failure-other',
      metric: 'om.enricher.duration',
      err: telemetryError,
    })

    await applyResponseEnrichers([{ id: 'person-1' }], 'customers.person', context, [entry])

    expect(recordHistogram).toHaveBeenCalledTimes(4)
    expect(loggerWarn).toHaveBeenCalledTimes(3)
    expect(loggerWarn).toHaveBeenNthCalledWith(3, 'Enricher duration metric recording failed', {
      enricherId: 'test.metric-failure',
      metric: 'om.enricher.duration',
      err: telemetryError,
    })
  })
})

describe('enricher runner', () => {
  it('partitions wildcard read-through cache entries by concrete entity', async () => {
    const cacheEntries = new Map<string, unknown>()
    const cache = {
      get: jest.fn(async (key: string) => cacheEntries.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        cacheEntries.set(key, value)
      }),
    }
    const enrichOne = jest.fn(
      async (record: Record<string, unknown>, context: EnricherContext) => ({
        ...record,
        enrichedFrom: context.targetEntity,
      }),
    )
    const enricher: ResponseEnricher<
      Record<string, unknown>,
      { enrichedFrom: string | undefined }
    > = {
      id: 'test.wildcard-cache',
      targetEntity: '*',
      timeout: 10,
      cache: { strategy: 'read-through', ttl: 60_000 },
      enrichOne,
    }
    registerResponseEnrichers([{ moduleId: 'test', enrichers: [enricher] }])

    const cacheContext: EnricherContext = {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      em: {},
      container: { resolve: () => cache },
    }

    const personResult = await applyResponseEnricherToRecord(
      { id: 'shared-id' },
      'customers.person',
      cacheContext,
    )
    const orderResult = await applyResponseEnricherToRecord(
      { id: 'shared-id' },
      'sales.order',
      cacheContext,
    )

    expect(personResult.record).toMatchObject({ enrichedFrom: 'customers.person' })
    expect(orderResult.record).toMatchObject({ enrichedFrom: 'sales.order' })
    expect(enrichOne).toHaveBeenCalledTimes(2)
    expect(Array.from(cacheEntries.keys())).toEqual([
      expect.stringContaining('entity:customers.person'),
      expect.stringContaining('entity:sales.order'),
    ])
  })
})
