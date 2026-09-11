import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

export const metadata = {
  event: 'wms.inventory_reservation.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-reservation',
}

export default createInventoryEnricherCacheHandler('inventory')
