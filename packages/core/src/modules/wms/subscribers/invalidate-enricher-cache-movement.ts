import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

export const metadata = {
  event: 'wms.inventory_movement.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-movement',
}

export default createInventoryEnricherCacheHandler('inventory')
