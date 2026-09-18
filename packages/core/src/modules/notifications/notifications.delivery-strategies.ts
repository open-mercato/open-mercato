import type { NotificationDeliveryStrategy } from './lib/deliveryStrategies'
import { inAppDeliveryStrategy } from './lib/strategies/in-app-delivery-strategy'
import { emailDeliveryStrategy } from './lib/strategies/email-delivery-strategy'

/**
 * Core-owned delivery strategies, discovered by the notifications `delivery-strategies` generator
 * plugin (see `generators.ts`) and registered at bootstrap. `push` is contributed separately by the
 * `push_notifications` module through its own `notifications.delivery-strategies.ts`.
 */
export const deliveryStrategies: NotificationDeliveryStrategy[] = [
  inAppDeliveryStrategy,
  emailDeliveryStrategy,
]

export default deliveryStrategies
