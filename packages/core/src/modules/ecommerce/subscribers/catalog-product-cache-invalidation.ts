import { invalidateForProductEvent } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'catalog.product.*',
  persistent: false,
  id: 'ecommerce:catalog-product-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForProductEvent(payload, ctx)
}
