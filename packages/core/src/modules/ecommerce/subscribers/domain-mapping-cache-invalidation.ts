import { invalidateForEvent, domainMappingEventTags } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'customer_accounts.domain_mapping.*',
  persistent: false,
  id: 'ecommerce:domain-mapping-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForEvent(payload, ctx, domainMappingEventTags)
}
