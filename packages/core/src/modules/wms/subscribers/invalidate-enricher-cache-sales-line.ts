import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

// The sales module declares `sales.line.*` in its event registry and documents
// it publicly, but no write surface emits it today — line writes ride the order
// commands' `sales.order.*`. Registering the pattern anyway costs one ephemeral
// subscription and means that wiring those events later cannot silently
// reintroduce the staleness `invalidate-enricher-cache-sales-order.ts` closes.
export const metadata = {
  event: 'sales.line.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-sales-line',
}

export default createInventoryEnricherCacheHandler('warehouse')
