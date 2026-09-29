import type { NotificationChannelDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * Core-owned delivery channels. `notifications` is the channel-metadata authority (labels shown in the
 * preferences UI + the `/api/notifications/channels` catalogue); the delivery *behavior* for each lives
 * in its own strategy (`in_app`/`email` here, `push` in `push_notifications`). Third-party modules add
 * further channels by shipping their own generator-discovered `notification-channels.ts`.
 */
export const notificationChannels: NotificationChannelDefinition[] = [
  {
    id: 'in_app',
    labelKey: 'notifications.preferences.channels.inApp',
    descriptionKey: 'notifications.preferences.channels.inAppHint',
    order: 10,
  },
  {
    id: 'email',
    labelKey: 'notifications.preferences.channels.email',
    descriptionKey: 'notifications.preferences.channels.emailHint',
    order: 20,
  },
  {
    id: 'push',
    labelKey: 'notifications.preferences.channels.push',
    descriptionKey: 'notifications.preferences.channels.pushHint',
    order: 30,
  },
]

export default notificationChannels
