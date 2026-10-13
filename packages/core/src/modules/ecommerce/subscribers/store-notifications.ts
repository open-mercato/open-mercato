import { notifyStoreManagers } from '../lib/storeNotifications'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'ecommerce.store.misconfigured',
  persistent: true,
  id: 'ecommerce:store-misconfigured-notification',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  await notifyStoreManagers(payload, ctx, 'ecommerce.store.channel_binding_missing')
}
