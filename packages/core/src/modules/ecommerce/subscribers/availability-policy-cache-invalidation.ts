import { invalidateForAvailabilityPolicyEvent } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'availability.policy.*',
  persistent: false,
  id: 'ecommerce:availability-policy-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForAvailabilityPolicyEvent(payload, ctx)
}
