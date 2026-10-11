// Invalidates the wms availability read-through cache when an inventory profile
// changes; safety stock and reorder point feed the cached sellable quantity.
// Same ephemeral contract as `invalidate-availability-cache.ts`; the 60s TTL is the backstop.

import invalidateAvailabilityCache from './invalidate-availability-cache'

export const metadata = {
  event: 'wms.inventory_profile.*',
  persistent: false,
  id: 'wms:invalidate-availability-cache-profile',
}

export default async function handle(
  payload: unknown,
  ctx: Parameters<typeof invalidateAvailabilityCache>[1],
): Promise<void> {
  await invalidateAvailabilityCache(payload, ctx)
}
