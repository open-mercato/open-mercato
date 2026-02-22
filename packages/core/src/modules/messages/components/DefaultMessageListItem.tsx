"use client"

import type { MessageListItemProps } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { CheckCircle2, FileText, Paperclip, Zap } from 'lucide-react'

function formatDateTime(value: Date | null): string {
  if (!value) return '—'
  if (Number.isNaN(value.getTime())) return '—'
  return value.toLocaleString()
}

function formatSentTime(value: Date | null): string {
  if (!value) return '—'
  if (Number.isNaN(value.getTime())) return '—'

  const now = new Date()
  const isSameDay = now.toDateString() === value.toDateString()
  if (isSameDay) {
    return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const isSameYear = now.getFullYear() === value.getFullYear()
  if (isSameYear) {
    return value.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return value.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

function truncateWords(value: string, maxWords: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return '—'
  const words = normalized.split(' ')
  if (words.length <= maxWords) return normalized
  return `${words.slice(0, maxWords).join(' ')}...`
}

export function DefaultMessageListItem({ message, onClick }: MessageListItemProps) {
  const t = useT()
  const senderLabel = message.senderName || '—'
  const subject = message.subject || '—'
  const absoluteSentAt = formatDateTime(message.sentAt)
  const sentAtLabel = formatSentTime(message.sentAt)
  const bodyPreview = truncateWords(message.body || '', 16)

  return (
    <div
      className={cn(
        'group min-w-0 w-full cursor-pointer rounded-md px-2 py-2 transition-colors hover:bg-muted/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
      role="button"
      tabIndex={0}
      aria-label={t(
        'messages.openMessageA11y',
        `Open message ${subject} from ${senderLabel}, sent ${absoluteSentAt}`,
      )}
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

        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <span className={cn('truncate text-foreground', message.unread ? 'font-semibold' : 'font-normal')}>
            {subject}
          </span>
          <span className="text-muted-foreground">-</span>
          <span className="truncate text-muted-foreground">{bodyPreview}</span>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5 text-muted-foreground">
          {message.hasObjects ? <FileText className="h-3.5 w-3.5" aria-hidden /> : null}
          {message.hasAttachments ? <Paperclip className="h-3.5 w-3.5" aria-hidden /> : null}
          {message.hasActions && !message.actionTaken ? (
            <Zap className="h-3.5 w-3.5 text-amber-600" aria-hidden />
          ) : null}
          {message.actionTaken ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" aria-hidden /> : null}
        </div>

        <span
          className={cn('flex-shrink-0 text-xs', message.unread ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground')}
          title={absoluteSentAt}
        >
          {sentAtLabel}
        </span>
      </div>
    </div>
  )
}

export default DefaultMessageListItem
