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

export function MessageReceivedRenderer({ notification }: NotificationRendererProps) {
  const t = useT()
  const senderName =
    (notification.metadata?.senderDisplayName as string | undefined) ??
    (notification.metadata?.senderIdentifier as string | undefined) ??
    t('communication_channels.notifications.message_received.unknownSender', 'Unknown sender')
  const channelLabel =
    (notification.metadata?.channelDisplayName as string | undefined) ??
    (notification.metadata?.providerKey as string | undefined) ??
    ''

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-foreground">
        {notification.title ??
          t('communication_channels.notifications.message_received.title', 'New external message')}
      </span>
      <span className="text-sm text-muted-foreground">
        {channelLabel ? `${senderName} · ${channelLabel}` : senderName}
      </span>
      {notification.body ? (
        <span className="text-sm text-muted-foreground line-clamp-2">{notification.body}</span>
      ) : null}
    </div>
  )
}

export default MessageReceivedRenderer
