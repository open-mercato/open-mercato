import { createInventoryEnricherCacheHandler } from '../lib/inventoryEnricherCacheSubscriber'

// Sales-order enricher `inboundSummary` aggregates open ASN rows (`draft` /
// `in_transit`). ASN lifecycle writes change that projection without always
// touching balances, so they need their own invalidation family.
export const metadata = {
  event: 'wms.asn.*',
  persistent: false,
  id: 'wms:invalidate-enricher-cache-asn',
}

export default createInventoryEnricherCacheHandler('inventory')
