import { invalidateWmsInventoryEnricherCache } from '../invalidateInventoryEnricherCache'
import { createInventoryEnricherCacheHandler } from '../inventoryEnricherCacheSubscriber'
import {
  WMS_INVENTORY_CACHE_TAG,
  WMS_WAREHOUSE_CACHE_TAG,
} from '../enricherCacheTags'

const runWithCacheTenant = jest.fn()

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: (tenantId: string | null, fn: () => unknown) => {
    runWithCacheTenant(tenantId)
    return fn()
  },
}))

function makeContainer(cache: { deleteByTags: jest.Mock } | null) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'cache' && cache) return cache as T
      throw new Error(`[internal] ${name} not registered`)
    },
  }
}

describe('invalidateWmsInventoryEnricherCache', () => {
  beforeEach(() => {
    runWithCacheTenant.mockClear()
  })

  it('drops both tags for the "all" scope', async () => {
    const deleteByTags = jest.fn(async () => 2)
    await invalidateWmsInventoryEnricherCache(makeContainer({ deleteByTags }), 'tenant-1', 'all')

    expect(deleteByTags).toHaveBeenCalledWith([WMS_INVENTORY_CACHE_TAG, WMS_WAREHOUSE_CACHE_TAG])
  })

  it('drops only the inventory tag for the "inventory" scope', async () => {
    const deleteByTags = jest.fn(async () => 1)
    await invalidateWmsInventoryEnricherCache(
      makeContainer({ deleteByTags }),
      'tenant-1',
      'inventory',
    )

    expect(deleteByTags).toHaveBeenCalledWith([WMS_INVENTORY_CACHE_TAG])
  })

  it('drops only the warehouse tag for the "warehouse" scope', async () => {
    const deleteByTags = jest.fn(async () => 1)
    await invalidateWmsInventoryEnricherCache(
      makeContainer({ deleteByTags }),
      'tenant-1',
      'warehouse',
    )

    expect(deleteByTags).toHaveBeenCalledWith([WMS_WAREHOUSE_CACHE_TAG])
  })

  it('enters the cache tenant scope so the tag prefixes match the ones the request path wrote', async () => {
    const deleteByTags = jest.fn(async () => 1)
    await invalidateWmsInventoryEnricherCache(makeContainer({ deleteByTags }), 'tenant-42')

    expect(runWithCacheTenant).toHaveBeenCalledWith('tenant-42')
  })

  it('does nothing without a tenant id, because an unscoped drop would target the wrong prefix', async () => {
    const deleteByTags = jest.fn(async () => 1)
    await invalidateWmsInventoryEnricherCache(makeContainer({ deleteByTags }), null)

    expect(deleteByTags).not.toHaveBeenCalled()
  })

  it('does nothing when no cache service is registered', async () => {
    await expect(
      invalidateWmsInventoryEnricherCache(makeContainer(null), 'tenant-1'),
    ).resolves.toBeUndefined()
  })

  it('swallows a failing invalidation so the write that triggered it still succeeds', async () => {
    const deleteByTags = jest.fn(async () => {
      throw new Error('cache down')
    })

    await expect(
      invalidateWmsInventoryEnricherCache(makeContainer({ deleteByTags }), 'tenant-1'),
    ).resolves.toBeUndefined()
  })
})

describe('createInventoryEnricherCacheHandler', () => {
  beforeEach(() => {
    runWithCacheTenant.mockClear()
  })

  it('invalidates using the tenant id carried on the event payload', async () => {
    const deleteByTags = jest.fn(async () => 1)
    const handler = createInventoryEnricherCacheHandler('inventory')

    await handler({ tenantId: 'tenant-1', id: 'balance-1' }, {
      ...makeContainer({ deleteByTags }),
    })

    expect(deleteByTags).toHaveBeenCalledWith([WMS_INVENTORY_CACHE_TAG])
    expect(runWithCacheTenant).toHaveBeenCalledWith('tenant-1')
  })

  it('falls back to the tenant id on the subscriber context', async () => {
    const deleteByTags = jest.fn(async () => 1)
    const handler = createInventoryEnricherCacheHandler('warehouse')

    await handler({ id: 'warehouse-1' }, {
      ...makeContainer({ deleteByTags }),
      tenantId: 'tenant-ctx',
    })

    expect(deleteByTags).toHaveBeenCalledWith([WMS_WAREHOUSE_CACHE_TAG])
    expect(runWithCacheTenant).toHaveBeenCalledWith('tenant-ctx')
  })

  it('does nothing when neither the payload nor the context carries a tenant', async () => {
    const deleteByTags = jest.fn(async () => 1)
    const handler = createInventoryEnricherCacheHandler('inventory')

    await handler({ id: 'balance-1' }, { ...makeContainer({ deleteByTags }) })

    expect(deleteByTags).not.toHaveBeenCalled()
  })
})
