import { invalidateForEvent, customerGroupMembershipEventTags } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'customer_groups.membership.*',
  persistent: false,
  id: 'ecommerce:customer-group-membership-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForEvent(payload, ctx, customerGroupMembershipEventTags)
}
