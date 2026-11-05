import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'push_notifications.delivery.sent', label: 'Push Delivery Sent', entity: 'delivery', category: 'lifecycle' },
  {
    id: 'push_notifications.delivery.failed',
    label: 'Push Delivery Failed',
    entity: 'delivery',
    category: 'lifecycle',
    // Fires on every failed send attempt for a delivery, not only the terminal one. A retryable
    // failure that will be re-attempted carries `willRetry: true`; the final give-up (and terminal
    // errors like channel_unavailable / no_adapter) omit it. Subscribers that count "deliveries that
    // ultimately failed" MUST filter to `willRetry !== true` to avoid double-counting retries.
    description: 'A push delivery attempt failed. Carries willRetry:true when another attempt is scheduled.',
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'push_notifications', events })
export const emitPushNotificationsEvent = eventsConfig.emit
export type PushNotificationsEventId = typeof events[number]['id']
export default eventsConfig
