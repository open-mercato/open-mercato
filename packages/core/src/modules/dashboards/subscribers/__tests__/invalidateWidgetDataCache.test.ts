/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { createCacheService, runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import handler, { metadata } from '../invalidateWidgetDataCache'
import { WidgetDataService, type WidgetDataRequest } from '../../services/widgetDataService'
import type { AnalyticsRegistry } from '../../services/analyticsRegistry'
import type { BaseCurrencyResolver } from '../../lib/optionalBaseCurrency'

jest.mock('../../lib/aggregations', () => ({
  ...jest.requireActual('../../lib/aggregations'),
  buildAggregationQuery: jest.fn(() => ({ sql: 'SELECT 1', params: [] })),
}))

const request: WidgetDataRequest = {
  entityType: 'sales:orders',
  metric: { field: 'total', aggregate: 'sum' },
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

function createService(cache: CacheStrategy, resolver: BaseCurrencyResolver) {
  const em = {
    getConnection: () => ({
      execute: async () => [{ value: 10 }],
    }),
  } as unknown as EntityManager
  return new WidgetDataService({
    em,
    scope: { tenantId: 'tenant-1', organizationIds: ['org-1'] },
    registry: createRegistry(),
    cache,
    baseCurrencyResolver: resolver,
  })
}

function createContext(cache?: CacheStrategy) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'cache' && cache) return cache as unknown as T
      throw new Error(`[internal] Missing DI service: ${name}`)
    },
  }
}

describe('dashboards currency cache invalidation subscriber', () => {
  test('subscribes ephemerally to all currency CRUD events', () => {
    expect(metadata).toEqual({
      event: 'currencies.currency.*',
      persistent: false,
      id: 'dashboards:invalidate-widget-data-on-currency-change',
    })
  })

  test('invalidates a cached currency label before the next widget request', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    let currency = 'PLN'
    const resolver: BaseCurrencyResolver = {
      resolveBaseCurrency: async () => ({ status: 'resolved', code: currency }),
    }

    await runWithCacheTenant('tenant-1', async () => {
      const initial = await createService(cache, resolver).fetchWidgetData(request)
      expect(initial.metadata.currency).toBe('PLN')

      currency = 'EUR'
      const stale = await createService(cache, resolver).fetchWidgetData(request)
      expect(stale.metadata.currency).toBe('PLN')
    })

    await handler({ tenantId: 'tenant-1' }, createContext(cache))

    await runWithCacheTenant('tenant-1', async () => {
      const refreshed = await createService(cache, resolver).fetchWidgetData(request)
      expect(refreshed.metadata.currency).toBe('EUR')
    })
  })

  test('does not invalidate another tenant or fail when cache is unavailable', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await runWithCacheTenant('tenant-2', () => cache.set('widget-data:test', { value: 1 }, {
      tags: ['widget-data'],
    }))

    await handler({ tenantId: 'tenant-1' }, createContext(cache))
    await expect(runWithCacheTenant('tenant-2', () => cache.get('widget-data:test'))).resolves.toEqual({ value: 1 })
    await expect(handler({ tenantId: 'tenant-1' }, createContext())).resolves.toBeUndefined()
  })
})
