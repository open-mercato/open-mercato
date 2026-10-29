/**
 * Subscriber for `communication_channels.channel.visibility_changed`.
 *
 * Flipping a whole mailbox between private and shared changes which email rows
 * the person-detail read filter admits, without writing any resource whose
 * collection tags the cached person-detail payload observes — so nothing else
 * invalidates it. The revoke direction is the one that matters: without this a
 * teammate keeps reading now-private email from their own warm cache entry for
 * the rest of the TTL.
 *
 * The invalidation lives on the CUSTOMERS side because the cache it clears is
 * this module's. `communication_channels` declares `requires: ['progress']` and
 * must not grow a dependency on `customers` to do its own writes — the hub emits
 * the event with the tenant/organization scope, and whoever cares reacts. Same
 * direction as the two `link-channel-message-*` subscribers.
 *
 * Ephemeral on purpose. Under single-delivery, persistent subscribers run ONLY
 * in the events worker, which would leave the stale entry readable until the
 * queue drains; inline delivery keeps the invalidation on the same path the
 * write already takes, matching the behaviour when the channel route called the
 * helper directly. Cache invalidation is a read-your-writes concern, the same
 * reason `query_index.upsert_one` is ephemeral.
 */
import { invalidatePersonDetailCache } from '../lib/personDetailCacheTags'

type ChannelVisibilityChangedPayload = {
  tenantId?: string | null
  organizationId?: string | null
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

export const metadata = {
  event: 'communication_channels.channel.visibility_changed',
  persistent: false,
  id: 'customers:channel-visibility-changed',
}

export default async function handler(
  payload: ChannelVisibilityChangedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  // Fail closed: the cache tags are tenant-scoped, and building them from a null
  // tenant would clear a tag set that belongs to no one.
  const tenantId = typeof payload?.tenantId === 'string' && payload.tenantId ? payload.tenantId : null
  if (!tenantId) return
  await invalidatePersonDetailCache(ctx, tenantId, payload?.organizationId ?? null)
}
