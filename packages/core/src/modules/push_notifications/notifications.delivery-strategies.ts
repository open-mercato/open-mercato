import type { NotificationDeliveryStrategy } from '@open-mercato/core/modules/notifications/lib/deliveryStrategies'
import { mobilePushDeliveryStrategy } from './lib/push-delivery-strategy'

// Discovered by the notifications `delivery-strategies` generator plugin and registered into the
// notifications delivery seam at bootstrap (see notifications/generators.ts).
export const deliveryStrategies: NotificationDeliveryStrategy[] = [mobilePushDeliveryStrategy]

export default deliveryStrategies
