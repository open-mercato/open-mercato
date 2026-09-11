import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

export const metadata = {
  event: 'wms.inventory_profile.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-profile',
}

export default createInventoryEnricherCacheHandler('inventory')
