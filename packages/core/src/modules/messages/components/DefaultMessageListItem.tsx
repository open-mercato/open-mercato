"use client"

import type { MessageListItemProps } from '@open-mercato/shared/modules/messages/types'

function formatDateTime(value: Date | null): string {
  if (!value) return '—'
  if (Number.isNaN(value.getTime())) return '—'
  return value.toLocaleString()
}

export function DefaultMessageListItem({ message }: MessageListItemProps) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="truncate text-sm font-medium">{message.subject}</p>
      <p className="truncate text-xs text-muted-foreground">{message.body}</p>
      <p className="truncate text-xs text-muted-foreground">
        {message.senderName || '—'} • {formatDateTime(message.sentAt)}
      </p>
    </div>
  )
}

export default DefaultMessageListItem
