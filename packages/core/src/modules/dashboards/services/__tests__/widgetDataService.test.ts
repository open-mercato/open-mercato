/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  WidgetDataService,
  type WidgetDataRequest,
} from '../widgetDataService'
import type { AnalyticsRegistry } from '../analyticsRegistry'
import type { BaseCurrencyResolver, BaseCurrencyResolution } from '../../lib/optionalBaseCurrency'

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

/**
 * Registry for an entity that declares a per-row currency column, so the record-level
 * uniformity guard (#4676) is actually built instead of skipped.
 */
function createCurrencyAwareRegistry(currencyField: string | null = 'currencyCode'): AnalyticsRegistry {
  return {
    ...createRegistry(),
    getEntityTypeConfig: () => ({
      tableName: 'sales_orders',
      dateField: 'placed_at',
      defaultScopeFields: ['tenant_id', 'organization_id'],
      currencyField: currencyField ?? undefined,
    }),
    getFieldMapping: (_entityId: string, field: string) => {
      if (field === 'currencyCode') return { dbColumn: 'currency_code', type: 'text' as const }
      if (field === 'placedAt') return { dbColumn: 'placed_at', type: 'timestamp' as const }
      return { dbColumn: 'total', type: 'numeric' as const }
    },
  }
}

function isRowCurrencyQuery(sql: string): boolean {
  return sql.includes('SELECT DISTINCT UPPER(NULLIF(BTRIM(currency_code)')
}

function countAggregationCalls(execute: jest.Mock): number {
  return execute.mock.calls.filter(([sql]: [string]) => !isRowCurrencyQuery(sql)).length
}

function createBaseCurrencyResolver(
  result: BaseCurrencyResolution = { status: 'resolved', code: 'PLN' },
): BaseCurrencyResolver & { resolveBaseCurrency: jest.Mock } {
  return {
    resolveBaseCurrency: jest.fn(async () => result),
  }
}

function createService(
  execute: (sql: string, params: unknown[]) => Promise<ExecuteResult>,
  scope: { tenantId: string; organizationIds?: string[] } = { tenantId: 'tenant-1' },
  registry: AnalyticsRegistry = createRegistry(),
  baseCurrencyResolver?: BaseCurrencyResolver,
) {
  const em = {
    getConnection: () => ({ execute }),
  } as unknown as EntityManager
  return new WidgetDataService({
    em,
    scope,
    registry,
    baseCurrencyResolver,
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

    expect(countAggregationCalls(execute)).toBe(2)

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
    const execute = jest.fn(async (): Promise<ExecuteResult> => {
      return countAggregationCalls(execute) === 1 ? [{ value: 80 }] : [{ value: 100 }]
    })

    const service = createService(execute)
    const response = await service.fetchWidgetData(comparisonRequest)

    expect(countAggregationCalls(execute)).toBe(2)
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

    expect(countAggregationCalls(execute)).toBe(1)
    expect(response.value).toBe(42)
    expect(response.comparison).toBeUndefined()
  })
})

describe('WidgetDataService base currency resolution', () => {
  const request: WidgetDataRequest = {
    entityType: 'sales:orders',
    metric: { field: 'total', aggregate: 'sum' },
    dateRange: { field: 'created_at', preset: 'this_month' },
  }

  const execute = jest.fn(async (): Promise<ExecuteResult> => [{ value: 10 }])

  test('reports the code resolved by the currencies-owned service', async () => {
    const resolver = createBaseCurrencyResolver()
    const service = createService(
      execute,
      { tenantId: 'tenant-1', organizationIds: ['org-1'] },
      createRegistry(),
      resolver,
    )

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBe('PLN')
    expect(resolver.resolveBaseCurrency).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      organizationIds: ['org-1'],
    })
  })

  test.each<BaseCurrencyResolution>([
    { status: 'missing' },
    { status: 'ambiguous' },
    { status: 'unavailable' },
  ])('leaves the amount unlabelled for a $status resolution', async (result) => {
    const service = createService(
      execute,
      { tenantId: 'tenant-1', organizationIds: ['org-1'] },
      createRegistry(),
      createBaseCurrencyResolver(result),
    )

    await expect(service.fetchWidgetData(request)).resolves.toMatchObject({
      metadata: { currency: null },
    })
  })

  test('leaves an unbounded organization scope unlabelled without calling the resolver', async () => {
    const resolver = createBaseCurrencyResolver()
    const service = createService(execute, { tenantId: 'tenant-1' }, createRegistry(), resolver)

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
    expect(resolver.resolveBaseCurrency).not.toHaveBeenCalled()
  })

  test('degrades to null when the currencies module is disabled', async () => {
    const service = createService(execute, {
      tenantId: 'tenant-1',
      organizationIds: ['org-1'],
    })

    const response = await service.fetchWidgetData(request)

    expect(response.value).toBe(10)
    expect(response.metadata.currency).toBeNull()
  })

  test('resolves the base currency once per service instance', async () => {
    const resolver = createBaseCurrencyResolver()
    const service = createService(
      execute,
      { tenantId: 'tenant-1', organizationIds: ['org-1'] },
      createRegistry(),
      resolver,
    )

    await service.fetchWidgetData(request)
    await service.fetchWidgetData({ ...request, metric: { field: 'total', aggregate: 'avg' } })

    expect(resolver.resolveBaseCurrency).toHaveBeenCalledTimes(1)
  })
})

describe('WidgetDataService record-level currency uniformity (#4676)', () => {
  const scope = { tenantId: 'tenant-1', organizationIds: ['org-1'] }

  const request: WidgetDataRequest = {
    entityType: 'sales:orders',
    metric: { field: 'total', aggregate: 'sum' },
    dateRange: { field: 'placedAt', preset: 'this_month' },
  }

  function createExecute(rowCurrencyRows: ExecuteResult) {
    return jest.fn(async (sql: string): Promise<ExecuteResult> => {
      if (isRowCurrencyQuery(sql)) return rowCurrencyRows
      return [{ value: 1000 }]
    })
  }

  const basePln = createBaseCurrencyResolver()

  test('keeps the base currency when every aggregated row carries it', async () => {
    const execute = createExecute([{ code: 'PLN' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBe('PLN')
  })

  test('does not label a total whose rows span several currencies', async () => {
    const execute = createExecute([{ code: 'PLN' }, { code: 'EUR' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    const response = await service.fetchWidgetData(request)

    expect(response.value).toBe(1000)
    expect(response.metadata.currency).toBeNull()
  })

  test('does not label a total whose only row currency differs from the base currency', async () => {
    const execute = createExecute([{ code: 'EUR' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('does not label a total whose rows have no recorded currency', async () => {
    const execute = createExecute([{ code: null }])
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('does not label a total when an unset currency sits alongside the base one', async () => {
    const execute = createExecute([{ code: null }, { code: '' }, { code: 'PLN' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('drops the label when an unset currency sits alongside a foreign one', async () => {
    const execute = createExecute([{ code: null }, { code: 'PLN' }, { code: 'EUR' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('keeps the base currency when the range aggregates no rows at all', async () => {
    const execute = createExecute([])
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBe('PLN')
  })

  test('scopes the row-currency lookup to the same tenant, organizations and date range', async () => {
    const execute = createExecute([{ code: 'PLN' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    await service.fetchWidgetData(request)

    const call = execute.mock.calls.find(([sql]: [string]) => isRowCurrencyQuery(sql))
    expect(call?.[0]).toContain('FROM "sales_orders"')
    expect(call?.[0]).toContain('deleted_at IS NULL')
    expect(call?.[0]).toContain('placed_at >= ?')
    expect(call?.[0]).toContain("UPPER(NULLIF(BTRIM(currency_code), ''))")
    expect(call?.[0]).toContain('LIMIT 2')
    expect(call?.[1]?.[0]).toBe('tenant-1')
    expect(call?.[1]?.[1]).toBe('{org-1}')
  })

  test('checks the comparison range as well, so a mixed comparison period is not labelled', async () => {
    let rowCurrencyCalls = 0
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> => {
      if (isRowCurrencyQuery(sql)) {
        rowCurrencyCalls += 1
        return rowCurrencyCalls === 1 ? [{ code: 'PLN' }] : [{ code: 'PLN' }, { code: 'EUR' }]
      }
      return [{ value: 1000 }]
    })
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    const response = await service.fetchWidgetData({
      ...request,
      comparison: { type: 'previous_period' },
    })

    expect(rowCurrencyCalls).toBe(2)
    expect(response.metadata.currency).toBeNull()
  })

  test('drops the label when the row-currency lookup fails', async () => {
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> => {
      if (isRowCurrencyQuery(sql)) throw new Error('column "currency_code" does not exist')
      return [{ value: 1000 }]
    })
    const service = createService(execute, scope, createCurrencyAwareRegistry(), basePln)

    const response = await service.fetchWidgetData(request)

    expect(response.value).toBe(1000)
    expect(response.metadata.currency).toBeNull()
  })

  test('keeps the base currency for an entity that declares no per-row currency column', async () => {
    const execute = createExecute([{ code: 'EUR' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry(null), basePln)

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBe('PLN')
    expect(execute.mock.calls.some(([sql]: [string]) => isRowCurrencyQuery(sql))).toBe(false)
  })

  test('does not query row currencies when no base currency resolved in the first place', async () => {
    const execute = createExecute([{ code: 'PLN' }])
    const service = createService(
      execute,
      scope,
      createCurrencyAwareRegistry(),
      createBaseCurrencyResolver({ status: 'missing' }),
    )

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
    expect(execute.mock.calls.some(([sql]: [string]) => isRowCurrencyQuery(sql))).toBe(false)
  })
})
