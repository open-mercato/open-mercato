/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  WidgetDataService,
  type WidgetDataRequest,
} from '../widgetDataService'
import type { AnalyticsRegistry } from '../analyticsRegistry'

jest.mock('../../lib/aggregations', () => ({
  ...jest.requireActual('../../lib/aggregations'),
  buildAggregationQuery: jest.fn(() => ({ sql: 'SELECT 1', params: [] })),
}))

type ExecuteResult = Array<Record<string, unknown>>

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function createRegistry(): AnalyticsRegistry {
  return {
    getAllEntityConfigs: () => [],
    getEntityConfig: () => null,
    isValidEntityType: () => true,
    getEntityTypeConfig: () => null,
    getFieldMapping: () => ({ dbColumn: 'total', type: 'number' }),
    getRequiredFeatures: () => null,
    getLabelResolverConfig: () => null,
    getAllFieldMappings: () => null,
  }
}

function createService(execute: (sql: string, params: unknown[]) => Promise<ExecuteResult>) {
  const em = {
    getConnection: () => ({ execute }),
  } as unknown as EntityManager
  return new WidgetDataService({
    em,
    scope: { tenantId: 'tenant-1' },
    registry: createRegistry(),
  })
}

function isBaseCurrencyQuery(sql: string): boolean {
  return sql.includes('FROM currencies')
}

/** Every request also looks up the scope's base currency; count only the aggregations. */
function aggregationCallCount(execute: jest.Mock): number {
  return execute.mock.calls.filter(([sql]) => !isBaseCurrencyQuery(String(sql))).length
}

const comparisonRequest: WidgetDataRequest = {
  entityType: 'sales:orders',
  metric: { field: 'total', aggregate: 'sum' },
  dateRange: { field: 'created_at', preset: 'this_month' },
  comparison: { type: 'previous_period' },
}

describe('WidgetDataService comparison fetching', () => {
  test('runs the primary and comparison queries in parallel', async () => {
    const deferreds = [createDeferred<ExecuteResult>(), createDeferred<ExecuteResult>()]
    let started = 0
    const execute = jest.fn(async (sql: string) => {
      if (isBaseCurrencyQuery(sql)) return [] as ExecuteResult
      const deferred = deferreds[started]
      started += 1
      return deferred.promise
    })

    const service = createService(execute)
    const pending = service.fetchWidgetData(comparisonRequest)

    await Promise.resolve()
    await Promise.resolve()

    expect(aggregationCallCount(execute)).toBe(2)

    deferreds[0].resolve([{ value: 200 }])
    deferreds[1].resolve([{ value: 100 }])

    const response = await pending
    expect(response.value).toBe(200)
    expect(response.comparison).toEqual({
      value: 100,
      change: 100,
      direction: 'up',
    })
  })

  test('preserves the comparison response shape and math', async () => {
    const execute = jest.fn(async (sql: string, _params: unknown[]): Promise<ExecuteResult> => {
      if (isBaseCurrencyQuery(sql)) return []
      return aggregationCallCount(execute) === 1 ? [{ value: 80 }] : [{ value: 100 }]
    })

    const service = createService(execute)
    const response = await service.fetchWidgetData(comparisonRequest)

    expect(aggregationCallCount(execute)).toBe(2)
    expect(response.value).toBe(80)
    expect(response.data).toEqual([])
    expect(response.metadata.recordCount).toBe(1)
    expect(response.comparison).toEqual({
      value: 100,
      change: -20,
      direction: 'down',
    })
  })

  test('runs a single query and omits comparison when none is requested', async () => {
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> =>
      isBaseCurrencyQuery(sql) ? [] : [{ value: 42 }],
    )
    const service = createService(execute)

    const response = await service.fetchWidgetData({
      entityType: 'sales:orders',
      metric: { field: 'total', aggregate: 'sum' },
      dateRange: { field: 'created_at', preset: 'this_month' },
    })

    expect(aggregationCallCount(execute)).toBe(1)
    expect(response.value).toBe(42)
    expect(response.comparison).toBeUndefined()
  })
})

describe('WidgetDataService base currency metadata', () => {
  const simpleRequest: WidgetDataRequest = {
    entityType: 'sales:orders',
    metric: { field: 'total', aggregate: 'sum' },
    dateRange: { field: 'created_at', preset: 'this_month' },
  }

  test('reports the scope base currency', async () => {
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> =>
      isBaseCurrencyQuery(sql) ? [{ code: 'pln' }] : [{ value: 42 }],
    )

    const response = await createService(execute).fetchWidgetData(simpleRequest)

    expect(response.metadata.currency).toBe('PLN')
  })

  test('reports null when the scope has no base currency', async () => {
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> =>
      isBaseCurrencyQuery(sql) ? [] : [{ value: 42 }],
    )

    const response = await createService(execute).fetchWidgetData(simpleRequest)

    expect(response.metadata.currency).toBeNull()
  })

  test('reports null when the currencies table is unavailable', async () => {
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> => {
      if (isBaseCurrencyQuery(sql)) throw new Error('relation "currencies" does not exist')
      return [{ value: 42 }]
    })

    const response = await createService(execute).fetchWidgetData(simpleRequest)

    expect(response.metadata.currency).toBeNull()
    expect(response.value).toBe(42)
  })

  test('looks the base currency up once per service instance', async () => {
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> =>
      isBaseCurrencyQuery(sql) ? [{ code: 'EUR' }] : [{ value: 42 }],
    )
    const service = createService(execute)

    await service.fetchWidgetData(simpleRequest)
    await service.fetchWidgetData({ ...simpleRequest, dateRange: { field: 'created_at', preset: 'this_week' } })

    const currencyCalls = execute.mock.calls.filter(([sql]) => isBaseCurrencyQuery(String(sql)))
    expect(currencyCalls).toHaveLength(1)
  })
})
