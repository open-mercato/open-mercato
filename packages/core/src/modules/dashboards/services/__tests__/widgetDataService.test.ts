/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import {
  WidgetDataService,
  WidgetDataScanLimitError,
  WidgetDataEncryptionUnavailableError,
  type WidgetDataRequest,
} from '../widgetDataService'
import { createAnalyticsRegistry, type AnalyticsRegistry } from '../analyticsRegistry'
import { analyticsConfig as salesAnalyticsConfig } from '../../../sales/analytics'
import { buildAggregationQuery } from '../../lib/aggregations'

jest.mock('../../lib/aggregations', () => ({
  ...jest.requireActual('../../lib/aggregations'),
  buildAggregationQuery: jest.fn(() => ({ sql: 'SELECT 1', params: [] })),
}))

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/customFieldValues'),
  resolveTenantEncryptionService: jest.fn(() => null),
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

// Regression coverage for #4622: grouping by a column that is encrypted at rest must never bucket
// or render ciphertext.
describe('WidgetDataService encrypted group sources', () => {
  const salesRegistry = createAnalyticsRegistry([salesAnalyticsConfig])
  const dek = generateDek()
  const otherDek = generateDek()

  const regionRequest: WidgetDataRequest = {
    entityType: 'sales:orders',
    metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
    groupBy: { field: 'shippingAddressSnapshot.region', limit: 5 },
  }

  const encryptSnapshot = (snapshot: Record<string, unknown>, key = dek): string =>
    encryptWithAesGcm(JSON.stringify(snapshot), key).value as string

  function createEncryptedService(
    execute: (sql: string, params: unknown[]) => Promise<ExecuteResult>,
    encryptedFields: string[] | (() => Promise<string[]>) = ['shipping_address_snapshot'],
    tenantDek: string | null = dek,
    options: { isEnabled?: boolean; emptyOrmMetadata?: boolean } = {},
  ) {
    ;(resolveTenantEncryptionService as jest.Mock).mockReturnValue({
      isEnabled: () => options.isEnabled ?? true,
      getEncryptedFieldNames: jest.fn(async () =>
        typeof encryptedFields === 'function' ? encryptedFields() : encryptedFields,
      ),
      getDek: jest.fn(async () => (tenantDek ? { key: tenantDek } : null)),
    })

    const em = {
      getConnection: () => ({ execute }),
      getMetadata: () => ({
        getAll: () =>
          options.emptyOrmMetadata ? [] : [{ className: 'SalesOrder', tableName: 'sales_orders', properties: {} }],
      }),
    } as unknown as EntityManager

    return new WidgetDataService({ em, scope: { tenantId: 'tenant-1' }, registry: salesRegistry })
  }

  beforeAll(() => {
    registerEntityIds({ sales: { sales_order: 'sales:sales_order' } })
  })

  beforeEach(() => {
    jest.clearAllMocks()
    ;(resolveTenantEncryptionService as jest.Mock).mockReturnValue(null)
    ;(buildAggregationQuery as jest.Mock).mockReturnValue({ sql: 'SELECT 1', params: [] })
  })

  test('groups by the decrypted region instead of the ciphertext', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: encryptSnapshot({ region: 'Mazowieckie', city: 'Warszawa' }), metric_value: '100.5' },
      { group_source: encryptSnapshot({ region: 'Mazowieckie', city: 'Płock' }), metric_value: '200' },
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: '50' },
    ])

    const service = createEncryptedService(execute)
    const response = await service.fetchWidgetData(regionRequest)

    expect(response.data).toEqual([
      { groupKey: 'Mazowieckie', value: 300.5 },
      { groupKey: 'Pomorskie', value: 50 },
    ])
    expect(response.value).toBe(350.5)
    expect(JSON.stringify(response)).not.toContain(':v1')
  })

  test('scans rows instead of grouping in SQL', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [])
    const service = createEncryptedService(execute)

    await service.fetchWidgetData(regionRequest)

    expect(buildAggregationQuery).not.toHaveBeenCalled()
    const [sql] = execute.mock.calls[0]
    expect(sql).toContain('shipping_address_snapshot AS group_source')
    expect(sql).not.toContain('GROUP BY')
  })

  test('matches a camelCase encryption map entry against the analytics column', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: '10' },
    ])
    const service = createEncryptedService(execute, ['shippingAddressSnapshot'])

    const response = await service.fetchWidgetData(regionRequest)

    expect(response.data).toEqual([{ groupKey: 'Pomorskie', value: 10 }])
  })

  test('keeps the SQL aggregation path when the group column is not encrypted', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [{ group_key: 'paid', value: 10 }])
    const service = createEncryptedService(execute, ['internal_notes'])

    const response = await service.fetchWidgetData({
      entityType: 'sales:orders',
      metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
      groupBy: { field: 'status' },
    })

    expect(buildAggregationQuery).toHaveBeenCalled()
    expect(response.data).toEqual([{ groupKey: 'paid', value: 10 }])
  })

  test('buckets rows it cannot decrypt as unknown rather than leaking ciphertext', async () => {
    const foreignCiphertext = encryptSnapshot({ region: 'Śląskie' }, otherDek)
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: foreignCiphertext, metric_value: '75' },
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: '25' },
    ])

    const service = createEncryptedService(execute)
    const response = await service.fetchWidgetData({
      ...regionRequest,
      groupBy: { field: 'shippingAddressSnapshot.region', limit: 5, resolveLabels: true },
    })

    expect(response.data).toEqual([
      { groupKey: null, value: 75, groupLabel: undefined },
      { groupKey: 'Pomorskie', value: 25, groupLabel: 'Pomorskie' },
    ])
    expect(JSON.stringify(response)).not.toContain(foreignCiphertext)
  })

  test('handles plaintext rows written before encryption was enabled', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: { region: 'Pomorskie' }, metric_value: '10' },
      { group_source: null, metric_value: '5' },
    ])

    const service = createEncryptedService(execute)
    const response = await service.fetchWidgetData(regionRequest)

    expect(response.data).toEqual([
      { groupKey: 'Pomorskie', value: 10 },
      { groupKey: null, value: 5 },
    ])
  })

  test('counts rows rather than numeric values for the count aggregate', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: 'e2ba0f2e-1f0f-4e0e-9f0f-1f0f4e0e9f0f' },
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: '9f0f4e0e-1f0f-4e0e-9f0f-1f0f4e0e9f0f' },
    ])

    const service = createEncryptedService(execute)
    const response = await service.fetchWidgetData({
      ...regionRequest,
      metric: { field: 'id', aggregate: 'count' },
    })

    expect(response.data).toEqual([{ groupKey: 'Pomorskie', value: 2 }])
  })

  test('fails loudly instead of charting a truncated scan', async () => {
    const ciphertext = encryptSnapshot({ region: 'Pomorskie' })
    const rows = Array.from({ length: 20_001 }, () => ({ group_source: ciphertext, metric_value: '1' }))
    const execute = jest.fn(async (): Promise<ExecuteResult> => rows)

    const service = createEncryptedService(execute)

    await expect(service.fetchWidgetData(regionRequest)).rejects.toBeInstanceOf(WidgetDataScanLimitError)
  })

  test('detects the encrypted column when the request EntityManager reports no ORM metadata', async () => {
    // A forked request EM regularly returns an empty metadata registry; keying the encryption
    // lookup off it alone sent every production request back to the ciphertext SQL path (#4622).
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: '10' },
    ])
    const service = createEncryptedService(execute, ['shipping_address_snapshot'], dek, {
      emptyOrmMetadata: true,
    })

    const response = await service.fetchWidgetData(regionRequest)

    expect(buildAggregationQuery).not.toHaveBeenCalled()
    expect(response.data).toEqual([{ groupKey: 'Pomorskie', value: 10 }])
  })

  test('refuses the SQL fallback when the KMS is unhealthy', async () => {
    const ciphertext = encryptSnapshot({ region: 'Pomorskie' })
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: ciphertext, metric_value: '25' },
    ])

    // An unhealthy KMS makes `isEnabled()` false and leaves no tenant DEK, but the encryption map
    // still proves the column holds ciphertext.
    const service = createEncryptedService(execute, ['shipping_address_snapshot'], null, { isEnabled: false })

    await expect(service.fetchWidgetData(regionRequest)).rejects.toBeInstanceOf(
      WidgetDataEncryptionUnavailableError,
    )
    expect(buildAggregationQuery).not.toHaveBeenCalled()
    const [sql] = execute.mock.calls[0]
    expect(sql).not.toContain('GROUP BY')
  })

  test('refuses the SQL fallback when the encryption map lookup fails', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [])
    const service = createEncryptedService(execute, async () => {
      throw new Error('encryption_maps unavailable')
    })

    await expect(service.fetchWidgetData(regionRequest)).rejects.toBeInstanceOf(
      WidgetDataEncryptionUnavailableError,
    )
    expect(buildAggregationQuery).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  test('sums fractional money exactly instead of in binary floating point', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: '0.1' },
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: '0.2' },
      { group_source: encryptSnapshot({ region: 'Mazowieckie' }), metric_value: '1234567890.12' },
      { group_source: encryptSnapshot({ region: 'Mazowieckie' }), metric_value: '0.03' },
    ])

    const service = createEncryptedService(execute)
    const response = await service.fetchWidgetData(regionRequest)

    expect(response.data).toEqual([
      { groupKey: 'Mazowieckie', value: 1234567890.15 },
      { groupKey: 'Pomorskie', value: 0.3 },
    ])
    // The float path would produce 0.30000000000000004 here.
    expect(response.data[1].value).toBe(0.3)
  })

  test('averages fractional money without float drift', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: '0.1' },
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: '0.2' },
    ])

    const service = createEncryptedService(execute)
    const response = await service.fetchWidgetData({
      ...regionRequest,
      metric: { field: 'grandTotalGrossAmount', aggregate: 'avg' },
    })

    expect(response.data).toEqual([{ groupKey: 'Pomorskie', value: 0.15 }])
  })

  test.each(['sum', 'avg'] as const)(
    'reports %s over an all-null bucket as 0, mirroring COALESCE in the SQL path',
    async (aggregate) => {
      // buildAggregateExpression wraps SUM/AVG in COALESCE(..., 0), so a bucket whose metric column
      // is null for every row must not read as "no value" only because the group source is
      // encrypted — the same data would chart 0 for a plaintext tenant.
      const execute = jest.fn(async (): Promise<ExecuteResult> => [
        { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: null },
        { group_source: encryptSnapshot({ region: 'Mazowieckie' }), metric_value: '5' },
      ])

      const service = createEncryptedService(execute)
      const response = await service.fetchWidgetData({
        ...regionRequest,
        metric: { field: 'grandTotalGrossAmount', aggregate },
      })

      expect(response.data).toEqual([
        { groupKey: 'Mazowieckie', value: 5 },
        { groupKey: 'Pomorskie', value: 0 },
      ])
    },
  )

  test('orders buckets without a value last, mirroring ORDER BY value DESC NULLS LAST', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: null },
      { group_source: encryptSnapshot({ region: 'Mazowieckie' }), metric_value: '-40' },
      { group_source: encryptSnapshot({ region: 'Śląskie' }), metric_value: '0' },
    ])

    const service = createEncryptedService(execute)
    const response = await service.fetchWidgetData({
      ...regionRequest,
      metric: { field: 'grandTotalGrossAmount', aggregate: 'min' },
    })

    expect(response.data).toEqual([
      { groupKey: 'Śląskie', value: 0 },
      { groupKey: 'Mazowieckie', value: -40 },
      { groupKey: 'Pomorskie', value: null },
    ])
  })

  test('keeps a group limit on the highest-value buckets rather than the empty ones', async () => {
    const execute = jest.fn(async (): Promise<ExecuteResult> => [
      { group_source: encryptSnapshot({ region: 'Pomorskie' }), metric_value: null },
      { group_source: encryptSnapshot({ region: 'Mazowieckie' }), metric_value: '5' },
    ])

    const service = createEncryptedService(execute)
    const response = await service.fetchWidgetData({
      ...regionRequest,
      groupBy: { field: 'shippingAddressSnapshot.region', limit: 1 },
    })

    expect(response.data).toEqual([{ groupKey: 'Mazowieckie', value: 5 }])
  })
})
