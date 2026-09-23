import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

// `wms.sales-order-inventory` reads the order's lines, and both the required
// quantity behind `reservationSummary.status` and the variant list behind
// `stockSummary` come from them. Order lines are written inside the sales order
// commands, which emit `sales.order.*` — not a WMS event — so without this the
// enrichment would stay stale for the whole TTL after a line edit.
//
// Scope `warehouse` rather than `inventory`: `wms:warehouse` is declared by the
// sales-order enricher alone, so this drops exactly its entries and leaves the
// two catalog enrichers' caches intact.
export const metadata = {
  event: 'sales.order.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-sales-order',
}

export default createInventoryEnricherCacheHandler('warehouse')
