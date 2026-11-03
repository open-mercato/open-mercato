import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

export const metadata = {
  event: 'wms.warehouse.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-warehouse',
}

export default createInventoryEnricherCacheHandler('warehouse')
