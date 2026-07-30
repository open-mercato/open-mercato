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

function isBaseCurrencyQuery(sql: string): boolean {
  return sql.includes('FROM currencies')
}

function isRowCurrencyQuery(sql: string): boolean {
  return sql.includes('SELECT DISTINCT UPPER(NULLIF(BTRIM(currency_code)')
}

function countAggregationCalls(execute: jest.Mock): number {
  return execute.mock.calls.filter(([sql]: [string]) => !isBaseCurrencyQuery(sql)).length
}

function createService(
  execute: (sql: string, params: unknown[]) => Promise<ExecuteResult>,
  scope: { tenantId: string; organizationIds?: string[] } = { tenantId: 'tenant-1' },
  registry: AnalyticsRegistry = createRegistry(),
) {
  const em = {
    getConnection: () => ({ execute }),
  } as unknown as EntityManager
  return new WidgetDataService({
    em,
    scope,
    registry,
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
    const execute = jest.fn(async (sql: string) => {
      if (isBaseCurrencyQuery(sql)) return []
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
    const execute = jest.fn(async (sql: string, _params: unknown[]): Promise<ExecuteResult> => {
      if (isBaseCurrencyQuery(sql)) return []
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
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> =>
      isBaseCurrencyQuery(sql) ? [] : [{ value: 42 }],
    )
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

  function createCurrencyExecute(rows: ExecuteResult) {
    return jest.fn(async (sql: string): Promise<ExecuteResult> =>
      isBaseCurrencyQuery(sql) ? rows : [{ value: 10 }],
    )
  }

  test('reports the scope base currency instead of a hard-coded default', async () => {
    const execute = createCurrencyExecute([{ organization_id: 'org-1', code: 'PLN' }])
    const service = createService(execute, { tenantId: 'tenant-1', organizationIds: ['org-1'] })

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBe('PLN')
    const currencyCall = execute.mock.calls.find(([sql]: [string]) => isBaseCurrencyQuery(sql))
    expect(currencyCall?.[0]).toContain('is_base = true')
    expect(currencyCall?.[1]).toEqual(['tenant-1', '{org-1}'])
  })

  test('resolves to null when the scope spans different base currencies', async () => {
    const execute = createCurrencyExecute([
      { organization_id: 'org-1', code: 'PLN' },
      { organization_id: 'org-2', code: 'EUR' },
    ])
    const service = createService(execute, {
      tenantId: 'tenant-1',
      organizationIds: ['org-1', 'org-2'],
    })

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('resolves to null when one organization in the scope has no base currency', async () => {
    const execute = createCurrencyExecute([{ organization_id: 'org-1', code: 'PLN' }])
    const service = createService(execute, {
      tenantId: 'tenant-1',
      organizationIds: ['org-1', 'org-2'],
    })

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('resolves to null when no base currency is configured', async () => {
    const execute = createCurrencyExecute([])
    const service = createService(execute, { tenantId: 'tenant-1', organizationIds: ['org-1'] })

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('leaves an unbounded organization scope unlabelled without querying currencies', async () => {
    const execute = createCurrencyExecute([{ organization_id: 'org-1', code: 'PLN' }])
    const service = createService(execute)

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
    expect(execute.mock.calls.some(([sql]: [string]) => isBaseCurrencyQuery(sql))).toBe(false)
  })

  test('degrades to null when the currencies lookup fails', async () => {
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> => {
      if (isBaseCurrencyQuery(sql)) throw new Error('relation "currencies" does not exist')
      return [{ value: 10 }]
    })
    const service = createService(execute, { tenantId: 'tenant-1', organizationIds: ['org-1'] })

    const response = await service.fetchWidgetData(request)

    expect(response.value).toBe(10)
    expect(response.metadata.currency).toBeNull()
  })

  test('resolves the base currency once per service instance', async () => {
    const execute = createCurrencyExecute([{ organization_id: 'org-1', code: 'PLN' }])
    const service = createService(execute, { tenantId: 'tenant-1', organizationIds: ['org-1'] })

    await service.fetchWidgetData(request)
    await service.fetchWidgetData({ ...request, metric: { field: 'total', aggregate: 'avg' } })

    const currencyCalls = execute.mock.calls.filter(([sql]: [string]) => isBaseCurrencyQuery(sql))
    expect(currencyCalls).toHaveLength(1)
  })
})

describe('WidgetDataService record-level currency uniformity (#4676)', () => {
  const scope = { tenantId: 'tenant-1', organizationIds: ['org-1'] }

  const request: WidgetDataRequest = {
    entityType: 'sales:orders',
    metric: { field: 'total', aggregate: 'sum' },
    dateRange: { field: 'placedAt', preset: 'this_month' },
  }

  function createExecute(baseRows: ExecuteResult, rowCurrencyRows: ExecuteResult) {
    return jest.fn(async (sql: string): Promise<ExecuteResult> => {
      if (isBaseCurrencyQuery(sql)) return baseRows
      if (isRowCurrencyQuery(sql)) return rowCurrencyRows
      return [{ value: 1000 }]
    })
  }

  const basePln: ExecuteResult = [{ organization_id: 'org-1', code: 'PLN' }]

  test('keeps the base currency when every aggregated row carries it', async () => {
    const execute = createExecute(basePln, [{ code: 'PLN' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBe('PLN')
  })

  test('does not label a total whose rows span several currencies', async () => {
    const execute = createExecute(basePln, [{ code: 'PLN' }, { code: 'EUR' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData(request)

    expect(response.value).toBe(1000)
    expect(response.metadata.currency).toBeNull()
  })

  test('does not label a total whose only row currency differs from the base currency', async () => {
    const execute = createExecute(basePln, [{ code: 'EUR' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('does not label a total whose rows have no recorded currency', async () => {
    const execute = createExecute(basePln, [{ code: null }])
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('does not label a total when an unset currency sits alongside the base one', async () => {
    const execute = createExecute(basePln, [{ code: null }, { code: '' }, { code: 'PLN' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('drops the label when an unset currency sits alongside a foreign one', async () => {
    const execute = createExecute(basePln, [{ code: null }, { code: 'PLN' }, { code: 'EUR' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
  })

  test('keeps the base currency when the range aggregates no rows at all', async () => {
    const execute = createExecute(basePln, [])
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBe('PLN')
  })

  test('scopes the row-currency lookup to the same tenant, organizations and date range', async () => {
    const execute = createExecute(basePln, [{ code: 'PLN' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry())

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
      if (isBaseCurrencyQuery(sql)) return basePln
      if (isRowCurrencyQuery(sql)) {
        rowCurrencyCalls += 1
        return rowCurrencyCalls === 1 ? [{ code: 'PLN' }] : [{ code: 'PLN' }, { code: 'EUR' }]
      }
      return [{ value: 1000 }]
    })
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData({
      ...request,
      comparison: { type: 'previous_period' },
    })

    expect(rowCurrencyCalls).toBe(2)
    expect(response.metadata.currency).toBeNull()
  })

  test('drops the label when the row-currency lookup fails', async () => {
    const execute = jest.fn(async (sql: string): Promise<ExecuteResult> => {
      if (isBaseCurrencyQuery(sql)) return basePln
      if (isRowCurrencyQuery(sql)) throw new Error('column "currency_code" does not exist')
      return [{ value: 1000 }]
    })
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData(request)

    expect(response.value).toBe(1000)
    expect(response.metadata.currency).toBeNull()
  })

  test('keeps the base currency for an entity that declares no per-row currency column', async () => {
    const execute = createExecute(basePln, [{ code: 'EUR' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry(null))

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBe('PLN')
    expect(execute.mock.calls.some(([sql]: [string]) => isRowCurrencyQuery(sql))).toBe(false)
  })

  test('does not query row currencies when no base currency resolved in the first place', async () => {
    const execute = createExecute([], [{ code: 'PLN' }])
    const service = createService(execute, scope, createCurrencyAwareRegistry())

    const response = await service.fetchWidgetData(request)

    expect(response.metadata.currency).toBeNull()
    expect(execute.mock.calls.some(([sql]: [string]) => isRowCurrencyQuery(sql))).toBe(false)
  })
})
