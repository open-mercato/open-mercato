// Invalidates the wms availability read-through cache when an availability policy
// changes; backorder, preorder and order-quantity rules feed the cached state.
// Same ephemeral contract as `invalidate-availability-cache.ts`; the 60s TTL is the backstop.

import invalidateAvailabilityCache from './invalidate-availability-cache'

export const metadata = {
  event: 'availability.policy.*',
  persistent: false,
  id: 'wms:invalidate-availability-cache-policy',
}

export default async function handle(
  payload: unknown,
  ctx: Parameters<typeof invalidateAvailabilityCache>[1],
): Promise<void> {
  await invalidateAvailabilityCache(payload, ctx)
}
