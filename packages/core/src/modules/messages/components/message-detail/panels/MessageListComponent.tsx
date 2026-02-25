"use client"

import type { MessageListItemProps } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

function formatSentTime(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return '—'

  const now = new Date()
  if (now.toDateString() === value.toDateString()) {
    return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return value.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function normalizeBody(value: string | null): string {
  const normalized = (value ?? '').trim().replace(/\s+/g, ' ')
  return normalized || '—'
}

export function MessageListComponent({ message, onClick }: MessageListItemProps) {
  const t = useT()
  const senderLabel = message.senderName || '—'
  const body = normalizeBody(message.body)
  const sentAtLabel = formatSentTime(message.sentAt)

  return (
    <div
      className={cn(
        'group min-w-0 w-full cursor-pointer rounded-md px-2 py-2 transition-colors hover:bg-muted/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
      role="button"
      tabIndex={0}
      aria-label={t('messages.openMessageA11y', 'Open message from {sender}', { sender: senderLabel })}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <div className="flex items-center gap-3">
        <span className={cn('w-40 flex-shrink-0 truncate text-sm md:w-56', message.unread ? 'font-semibold' : 'font-normal')}>
          {senderLabel}
        </span>

        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{body}</span>

        <span
          className={cn('flex-shrink-0 text-xs', message.unread ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground')}
        >
          {sentAtLabel}
        </span>
      </div>
    </div>
  )
}

export default MessageListComponent
