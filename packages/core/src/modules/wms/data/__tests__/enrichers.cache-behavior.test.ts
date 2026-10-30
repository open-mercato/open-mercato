/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { applyResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-runner'
import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'
import { E } from '#generated/entities.ids.generated'
import { InventoryBalance, ProductInventoryProfile } from '../entities'
import { enrichers } from '../enrichers'

const findWithDecryptionMock = jest.mocked(findWithDecryption)
const findOneWithDecryptionMock = jest.mocked(findOneWithDecryption)

const productEnricher = enrichers.find((enricher) => enricher.id === 'wms.catalog-product-inventory')!

function createCache() {
  const store = new Map<string, unknown>()
  return {
    store,
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    deleteByTags: jest.fn(async (tags: string[]) => {
      // The runner's tags are opaque here; the unit under test only needs the
      // whole-store drop a tag invalidation produces for these entries.
      store.clear()
      return tags.length
    }),
  }
}

function createQueryEngine(handler: (entityId: string) => unknown[]) {
  return {
    query: jest.fn(async (entityId: string) => {
      const items = handler(entityId)
      return { items, page: 1, pageSize: items.length, total: items.length }
    }),
  }
}

function createContext(cache: ReturnType<typeof createCache>, queryEngine: ReturnType<typeof createQueryEngine>) {
  const em = {
    fork: () => ({}),
    persist: jest.fn(),
    create: jest.fn((_: unknown, data: unknown) => data),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  return {
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    userFeatures: ['wms.view'],
    em,
    container: {
      resolve: (name: string) => {
        if (name === 'cache') return cache
        if (name === 'em') return em
        if (name === 'queryEngine') return queryEngine
        throw new Error(`[internal] Unexpected resolve: ${name}`)
      },
    },
  } as never
}

describe('wms.catalog-product-inventory read-through cache behavior', () => {
  let onHand = '10'

  beforeEach(() => {
    registerResponseEnrichers([{ moduleId: 'wms', enrichers: [productEnricher] }])
    onHand = '10'
    findOneWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockResolvedValue(null)
    findWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === ProductInventoryProfile) return []
      if (entity === InventoryBalance) {
        return [
          {
            id: 'balance-1',
            catalogVariantId: 'variant-1',
            quantityOnHand: onHand,
            quantityReserved: '0',
            quantityAllocated: '0',
          },
        ]
      }
      return []
    })
  })

  afterAll(() => {
    registerResponseEnrichers([])
  })

  const variantsQueryEngine = () =>
    createQueryEngine((entityId) =>
      entityId === E.catalog.catalog_product_variant
        ? [{ id: 'variant-1', product_id: 'product-1' }]
        : [],
    )

  it('performs no cross-module reads on a second enrichment within the TTL', async () => {
    const cache = createCache()
    const queryEngine = variantsQueryEngine()
    const records = [{ id: 'product-1', name: 'Widget' }]

    const first = await applyResponseEnrichers(
      records,
      E.catalog.catalog_product,
      createContext(cache, queryEngine),
    )
    expect((first.items[0] as { _wms: { stockSummary: Array<{ available: string }> } })._wms.stockSummary[0].available).toBe('10')

    const readsAfterFirst = queryEngine.query.mock.calls.length + findWithDecryptionMock.mock.calls.length
    expect(readsAfterFirst).toBeGreaterThan(0)

    const second = await applyResponseEnrichers(
      records,
      E.catalog.catalog_product,
      createContext(cache, queryEngine),
    )

    expect(queryEngine.query.mock.calls.length + findWithDecryptionMock.mock.calls.length).toBe(
      readsAfterFirst,
    )
    expect((second.items[0] as { _wms: { stockSummary: Array<{ available: string }> } })._wms.stockSummary[0].available).toBe('10')
  })

  it('reflects a stock change after the WMS write drops the cache tag', async () => {
    const cache = createCache()
    const queryEngine = variantsQueryEngine()
    const records = [{ id: 'product-1', name: 'Widget' }]

    await applyResponseEnrichers(records, E.catalog.catalog_product, createContext(cache, queryEngine))

    onHand = '3'
    await cache.deleteByTags(['wms:inventory'])

    const afterWrite = await applyResponseEnrichers(
      records,
      E.catalog.catalog_product,
      createContext(cache, queryEngine),
    )

    expect((afterWrite.items[0] as { _wms: { stockSummary: Array<{ available: string }> } })._wms.stockSummary[0].available).toBe('3')
  })

  it('keeps base product fields fresh while serving the cached enrichment', async () => {
    const cache = createCache()
    const queryEngine = variantsQueryEngine()

    await applyResponseEnrichers(
      [{ id: 'product-1', name: 'Old name' }],
      E.catalog.catalog_product,
      createContext(cache, queryEngine),
    )

    const second = await applyResponseEnrichers(
      [{ id: 'product-1', name: 'Renamed' }],
      E.catalog.catalog_product,
      createContext(cache, queryEngine),
    )

    expect((second.items[0] as { name: string }).name).toBe('Renamed')
    expect((second.items[0] as { _wms: unknown })._wms).toBeDefined()
  })
})
