import { invalidateForEvent, salesChannelEventTags } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'sales.channel.*',
  persistent: false,
  id: 'ecommerce:sales-channel-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForEvent(payload, ctx, salesChannelEventTags)
}
