import { invalidateForEvent, storeDomainBindingEventTags } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'ecommerce.store_domain_binding.*',
  persistent: false,
  id: 'ecommerce:store-domain-binding-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForEvent(payload, ctx, storeDomainBindingEventTags)
}
