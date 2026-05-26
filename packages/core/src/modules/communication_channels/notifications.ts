import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'communication_channels.message.received',
    module: 'communication_channels',
    titleKey: 'communication_channels.notifications.message_received.title',
    bodyKey: 'communication_channels.notifications.message_received.body',
    icon: 'message-circle',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/messages/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/messages/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
  {
    /**
     * Channel-agnostic notification raised when an adapter loses authorization
     * (OAuth refresh token revoked, IMAP/SMTP password rotated, WhatsApp token expired).
     * Emitted by the `markChannelRequiresReauth` command. Consumed by the
     * email integration spec's reconnect flow.
     */
    type: 'communication_channels.channel.requires_reauth',
    module: 'communication_channels',
    titleKey: 'communication_channels.notifications.channel_requires_reauth.title',
    bodyKey: 'communication_channels.notifications.channel_requires_reauth.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [
      {
        id: 'reconnect',
        labelKey: 'communication_channels.notifications.channel_requires_reauth.reconnect',
        variant: 'outline',
        href: '/backend/profile/communication-channels?reconnect={sourceEntityId}',
        icon: 'refresh-cw',
      },
    ],
    linkHref: '/backend/profile/communication-channels?reconnect={sourceEntityId}',
    expiresAfterHours: 720, // 30 days — auth issues should be addressed promptly
  },
]

export default notificationTypes
