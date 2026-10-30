import { invalidateForEvent, customerGroupEventTags } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'customer_groups.group.*',
  persistent: false,
  id: 'ecommerce:customer-group-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForEvent(payload, ctx, customerGroupEventTags)
}
