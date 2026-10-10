import { invalidateForPriceEvent } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'catalog.price.*',
  persistent: false,
  id: 'ecommerce:catalog-price-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForPriceEvent(payload, ctx)
}
