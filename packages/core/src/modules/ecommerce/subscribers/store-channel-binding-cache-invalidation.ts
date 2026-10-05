import { invalidateForEvent, storeChannelBindingEventTags } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'ecommerce.store_channel_binding.*',
  persistent: false,
  id: 'ecommerce:store-channel-binding-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForEvent(payload, ctx, storeChannelBindingEventTags)
}
