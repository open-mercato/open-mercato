import { invalidateForEvent, customerUserEventTags } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'customer_accounts.user.updated',
  persistent: false,
  id: 'ecommerce:customer-user-updated-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForEvent(payload, ctx, customerUserEventTags)
}
