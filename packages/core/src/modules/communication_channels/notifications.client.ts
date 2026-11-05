'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { MessageReceivedRenderer } from './widgets/notifications/MessageReceivedRenderer'
import { ChannelRequiresReauthRenderer } from './widgets/notifications/ChannelRequiresReauthRenderer'

export const communicationChannelsNotificationTypes: NotificationTypeDefinition[] = [
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
    Renderer: MessageReceivedRenderer,
    expiresAfterHours: 168,
  },
  {
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
    Renderer: ChannelRequiresReauthRenderer,
    expiresAfterHours: 720,
  },
]

export default communicationChannelsNotificationTypes
