import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

export const metadata = {
  event: 'wms.inventory_balance.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-balance',
}

export default createInventoryEnricherCacheHandler('inventory')
