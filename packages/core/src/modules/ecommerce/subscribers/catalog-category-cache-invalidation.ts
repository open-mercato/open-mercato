import { invalidateForCategoryEvent } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'catalog.category.*',
  persistent: false,
  id: 'ecommerce:catalog-category-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForCategoryEvent(payload, ctx)
}
