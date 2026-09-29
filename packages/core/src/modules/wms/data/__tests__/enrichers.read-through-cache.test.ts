import { enrichers } from '../enrichers'
import {
  WMS_ENRICHER_CACHE_TTL_MS,
  WMS_INVENTORY_CACHE_TAG,
  WMS_WAREHOUSE_CACHE_TAG,
} from '../../lib/enricherCacheTags'

function byId(id: string) {
  const enricher = enrichers.find((candidate) => candidate.id === id)
  if (!enricher) throw new Error(`[internal] enricher ${id} not registered`)
  return enricher
}

describe('WMS inventory enrichers — read-through cache declaration', () => {
  it.each([
    'wms.sales-order-inventory',
    'wms.catalog-product-inventory',
    'wms.catalog-variant-inventory',
  ])('%s opts into the read-through cache with the shared short TTL', (id) => {
    const enricher = byId(id)
    expect(enricher.cache?.strategy).toBe('read-through')
    expect(enricher.cache?.ttl).toBe(WMS_ENRICHER_CACHE_TTL_MS)
    expect(enricher.cache?.tags).toContain(WMS_INVENTORY_CACHE_TAG)
  })

  it('tags the sales-order enricher with the warehouse tag it also depends on', () => {
    expect(byId('wms.sales-order-inventory').cache?.tags).toEqual(
      expect.arrayContaining([WMS_INVENTORY_CACHE_TAG, WMS_WAREHOUSE_CACHE_TAG]),
    )
  })

  it.each([
    'wms.sales-order-inventory',
    'wms.catalog-product-inventory',
    'wms.catalog-variant-inventory',
  ])('%s leaves cacheableOnListHit at its fail-closed default', (id) => {
    // These read across modules, and the CRUD list cache does not invalidate on
    // WMS writes. Embedding their output in a shared list-cache entry would
    // serve stock figures that no WMS write can evict.
    expect(byId(id).cacheableOnListHit).not.toBe(true)
  })
})
