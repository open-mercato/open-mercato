'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type NotificationRendererProps = {
  notification: {
    id: string
    type: string
    title?: string | null
    body?: string | null
    sourceEntityType?: string | null
    sourceEntityId?: string | null
    metadata?: Record<string, unknown> | null
  }
}

export function ChannelRequiresReauthRenderer({ notification }: NotificationRendererProps) {
  const t = useT()
  const channelName =
    (notification.metadata?.channelDisplayName as string | undefined) ??
    t('communication_channels.notifications.channel_requires_reauth.unknownChannel', 'A channel')
  const providerKey = (notification.metadata?.providerKey as string | undefined) ?? ''

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-status-warning-text">
        {notification.title ??
          t(
            'communication_channels.notifications.channel_requires_reauth.title',
            'Channel needs reconnection',
          )}
      </span>
      <span className="text-sm text-muted-foreground">
        {providerKey ? `${channelName} (${providerKey})` : channelName}
      </span>
      <span className="text-sm text-muted-foreground">
        {notification.body ??
          t(
            'communication_channels.notifications.channel_requires_reauth.body',
            'Authentication expired. Reconnect this channel to resume sending and receiving messages.',
          )}
      </span>
    </div>
  )
}

export default ChannelRequiresReauthRenderer
