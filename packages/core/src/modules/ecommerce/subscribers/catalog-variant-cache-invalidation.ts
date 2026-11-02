import { invalidateForVariantEvent } from '../lib/cacheInvalidation'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'catalog.variant.*',
  persistent: false,
  id: 'ecommerce:catalog-variant-cache-invalidation',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await invalidateForVariantEvent(payload, ctx)
}
