// Invalidates the wms AvailabilityProvider's read-through cache
// (`availabilityCache.ts`) whenever a balance changes. Ephemeral
// (`persistent: false`) — cache invalidation is a real-time housekeeping
// concern, not something that needs retry/audit semantics; the cache's own
// 60s TTL is the backstop if an event is ever lost.
//
// `wms.*` does NOT match `wms.inventory_balance.created` (single-segment
// matcher) — `wms.inventory_balance.*` matches all three CRUD actions
// (created/updated/deleted) in one subscriber, mirroring
// `invalidate-enricher-cache-balance.ts`.

import { invalidateWmsAvailabilityCache } from '../lib/availabilityCache'

export const metadata = {
  event: 'wms.inventory_balance.*',
  persistent: false,
  id: 'wms:invalidate-availability-cache',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const data = (payload ?? {}) as Record<string, unknown>
  const tenantId =
    typeof data.tenantId === 'string' && data.tenantId.length > 0 ? data.tenantId : ctx.tenantId ?? null
  await invalidateWmsAvailabilityCache(ctx, tenantId)
}
