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
    const execute = jest.fn(async () => {
      const deferred = deferreds[started]
      started += 1
      return deferred.promise
    })

    const service = createService(execute)
    const pending = service.fetchWidgetData(comparisonRequest)

    await Promise.resolve()
    await Promise.resolve()

    expect(execute).toHaveBeenCalledTimes(2)

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
    const execute = jest.fn(async (_sql: string, _params: unknown[]): Promise<ExecuteResult> => {
      const call = execute.mock.calls.length
      return call === 1 ? [{ value: 80 }] : [{ value: 100 }]
    })

    const service = createService(execute)
    const response = await service.fetchWidgetData(comparisonRequest)

    expect(execute).toHaveBeenCalledTimes(2)
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
    const execute = jest.fn(async (): Promise<ExecuteResult> => [{ value: 42 }])
    const service = createService(execute)

    const response = await service.fetchWidgetData({
      entityType: 'sales:orders',
      metric: { field: 'total', aggregate: 'sum' },
      dateRange: { field: 'created_at', preset: 'this_month' },
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(response.value).toBe(42)
    expect(response.comparison).toBeUndefined()
  })
})
