/**
 * Cache tags shared by the WMS inventory enrichers and the write surfaces that
 * invalidate them. Read side and write side MUST use these constants so the two
 * cannot drift — a tag typo on either side is silent, and the only symptom is
 * inventory that stays stale until the TTL expires.
 *
 * The enricher runner adds `tenant:`, `organization:` and `enricher:` tags of
 * its own, and the cache service prefixes every tag with the current cache
 * tenant, so these are deliberately coarse collection tags rather than
 * per-warehouse ones: `ResponseEnricher.cache.tags` is a static array read from
 * the enricher definition and cannot vary per call. Collection tags
 * over-invalidate slightly; a per-warehouse scheme that the write side could
 * miss would under-invalidate, which is the failure that actually shows wrong
 * stock to a user.
 */

/** Inventory quantities: balances, reservations, movements and profiles. */
export const WMS_INVENTORY_CACHE_TAG = 'wms:inventory'

/** Warehouse identity and sales-order warehouse assignment. */
export const WMS_WAREHOUSE_CACHE_TAG = 'wms:warehouse'

/**
 * Short by design. The tag invalidations below are the primary freshness
 * mechanism; this TTL is the unconditional backstop for anything they miss —
 * a write that failed to resolve the cache service, a cross-process race, or a
 * write surface added later without wiring invalidation.
 */
export const WMS_ENRICHER_CACHE_TTL_MS = 30_000

export const WMS_ENRICHER_CACHE_TAGS = [
  WMS_INVENTORY_CACHE_TAG,
  WMS_WAREHOUSE_CACHE_TAG,
] as const
