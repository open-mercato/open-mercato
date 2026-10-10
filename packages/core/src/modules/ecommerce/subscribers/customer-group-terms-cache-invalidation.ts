import { invalidateForEvent, customerGroupTermsEventTags } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'customer_groups.terms.updated',
  persistent: false,
  id: 'ecommerce:customer-group-terms-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForEvent(payload, ctx, customerGroupTermsEventTags)
}
