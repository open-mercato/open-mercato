import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

export const metadata = {
  event: 'wms.inventory.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-inventory',
}

export default createInventoryEnricherCacheHandler('inventory')
