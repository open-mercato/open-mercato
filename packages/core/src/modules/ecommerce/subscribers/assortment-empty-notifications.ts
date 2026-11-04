import { notifyStoreManagers } from '../lib/storeNotifications'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'ecommerce.assortment.empty_detected',
  persistent: true,
  id: 'ecommerce:assortment-empty-notification',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await notifyStoreManagers(payload, ctx, 'ecommerce.store.assortment_empty')
}
