import type { EntityManager } from '@mikro-orm/postgresql'
import { WidgetDataService, type WidgetDataScope } from '../widgetDataService'
import type { AnalyticsRegistry } from '../analyticsRegistry'
import { buildAggregationQuery } from '../../lib/aggregations'

jest.mock('../../lib/aggregations', () => ({
  ...jest.requireActual('../../lib/aggregations'),
  buildAggregationQuery: jest.fn(() => ({ sql: 'SELECT 1', params: [] })),
}))

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/customFieldValues'),
  resolveTenantEncryptionService: jest.fn(() => null),
}))

const registry: AnalyticsRegistry = {
  getAllEntityConfigs: () => [],
  getEntityConfig: () => null,
  isValidEntityType: () => true,
  getEntityTypeConfig: () => null,
  getFieldMapping: () => ({ dbColumn: 'total', type: 'number' }),
  getRequiredFeatures: () => null,
  getLabelResolverConfig: () => null,
  getAllFieldMappings: () => null,
} as unknown as AnalyticsRegistry

function serviceFor(scope: WidgetDataScope) {
  const em = { getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }) } as unknown as EntityManager
  return new WidgetDataService({ em, scope, registry })
}

function resolvedRangeStart(): Date {
  const call = (buildAggregationQuery as jest.Mock).mock.calls.at(-1)?.[0] as { dateRange?: { start: Date } }
  return call.dateRange!.start
}

describe('WidgetDataService this_week range', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(2026, 5, 17, 12, 0, 0))
    ;(buildAggregationQuery as jest.Mock).mockClear()
  })

  afterEach(() => jest.useRealTimers())

  const request = {
    entityType: 'sales:orders',
    metric: { field: 'total', aggregate: 'sum' as const },
    dateRange: { field: 'created_at', preset: 'this_week' as const },
  }

  it('starts on Monday when the scope carries no week start', async () => {
    await serviceFor({ tenantId: 'tenant-1' }).fetchWidgetData(request)
    expect(resolvedRangeStart()).toEqual(new Date(2026, 5, 15, 0, 0, 0, 0))
  })

  it('starts on the tenant-configured day', async () => {
    await serviceFor({ tenantId: 'tenant-1', weekStartsOn: 0 }).fetchWidgetData(request)
    expect(resolvedRangeStart()).toEqual(new Date(2026, 5, 14, 0, 0, 0, 0))
  })
})

describe('WidgetDataService weekly buckets', () => {
  const request = {
    entityType: 'sales:orders',
    metric: { field: 'total', aggregate: 'sum' as const },
    groupBy: { field: 'created_at', granularity: 'week' as const },
  }

  beforeEach(() => (buildAggregationQuery as jest.Mock).mockClear())

  it('passes the configured week start to the bucket query', async () => {
    await serviceFor({ tenantId: 'tenant-1', weekStartsOn: 0 }).fetchWidgetData(request)
    expect((buildAggregationQuery as jest.Mock).mock.calls.at(-1)?.[0]).toMatchObject({ weekStartsOn: 0 })
  })

  it('leaves the week start unset when the scope carries none', async () => {
    await serviceFor({ tenantId: 'tenant-1' }).fetchWidgetData(request)
    expect((buildAggregationQuery as jest.Mock).mock.calls.at(-1)?.[0].weekStartsOn).toBeUndefined()
  })
})
