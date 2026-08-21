import type { NotificationDeliveryStrategy } from '../deliveryStrategies'

export const IN_APP_CHANNEL = 'in_app'

/**
 * In-app is a first-class channel of the delivery seam, but its "delivery" is the `Notification` row
 * that `notificationService.create()` writes synchronously (the durable record that push/email
 * reference and that the bell renders). There is nothing to send here.
 *
 * Whether the row is *visible* in the bell/inbox is governed by `in_app ∈ notification.channels`
 * (resolved at create time by `shouldDeliver`) at the read layer — not by this strategy. Registering
 * it makes in_app appear in the strategy registry so the create-time gate and the dispatcher treat it
 * exactly like every other channel, with no channel-specific branch in the dispatcher.
 */
export const inAppDeliveryStrategy: NotificationDeliveryStrategy = {
  id: IN_APP_CHANNEL,
  defaultEnabled: true,
  deliver: () => {
    /* no-op: the row IS the in-app delivery; visibility is a read-layer concern */
  },
}
