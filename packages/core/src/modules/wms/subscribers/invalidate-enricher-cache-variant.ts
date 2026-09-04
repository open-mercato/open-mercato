import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

export const metadata = {
  event: 'catalog.variant.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-variant',
}

export default createInventoryEnricherCacheHandler('inventory')
