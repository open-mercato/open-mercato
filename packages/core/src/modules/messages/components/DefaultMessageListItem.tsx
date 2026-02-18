"use client"

import * as React from 'react'
import type { MessageListItemProps } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { CheckCircle2, FileText, Paperclip, Zap } from 'lucide-react'
import { PriorityBadge } from './PriorityBadge'

function formatDateTime(value: Date | null): string {
  if (!value) return '—'
  if (Number.isNaN(value.getTime())) return '—'
  return value.toLocaleString()
}

function formatRelativeDateTime(value: Date | null): string {
  if (!value) return '—'
  if (Number.isNaN(value.getTime())) return '—'

  const deltaMs = value.getTime() - Date.now()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })

  if (Math.abs(deltaMs) < hour) {
    return rtf.format(Math.round(deltaMs / minute), 'minute')
  }

  if (Math.abs(deltaMs) < day) {
    return rtf.format(Math.round(deltaMs / hour), 'hour')
  }

  if (Math.abs(deltaMs) < 7 * day) {
    return rtf.format(Math.round(deltaMs / day), 'day')
  }

  return value.toLocaleDateString()
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
  const messageTypeLabel = message.typeLabel || message.type || '—'
  const absoluteSentAt = formatDateTime(message.sentAt)
  const relativeSentAt = formatRelativeDateTime(message.sentAt)
  const bodyPreview = truncateWords(message.body || '', 100)
  const objectCount = Math.max(0, Number(message.objectCount ?? 0))
  const attachmentCount = Math.max(0, Number(message.attachmentCount ?? 0))

  const chips = React.useMemo(() => {
    const list: React.ReactNode[] = []

    if (message.hasActions && !message.actionTaken) {
      list.push(
        <Badge
          key="action-required"
          variant="outline"
          className="h-5 gap-1 border-amber-200 bg-amber-50 px-1.5 text-[11px] text-amber-800"
          title={t('messages.actionRequired', 'Action required')}
        >
          <Zap className="h-3 w-3" />
          <span>{t('messages.actionRequired', 'Action required')}</span>
        </Badge>,
      )
    }

    if (message.actionTaken) {
      list.push(
        <Badge
          key="action-taken"
          variant="secondary"
          className="h-5 gap-1 border-green-200 bg-green-50 px-1.5 text-[11px] text-green-800"
          title={t('messages.actionCompleted', 'Action completed')}
        >
          <CheckCircle2 className="h-3 w-3" />
          <span>{t('messages.actionCompleted', 'Action completed')}</span>
        </Badge>,
      )
    }

    list.push(
      <PriorityBadge
        key="priority"
        priority={message.priority}
        className="h-5 px-1.5 text-[11px]"
      />,
    )

    if (message.hasObjects) {
      const label = t('messages.objectsCount', `${Math.max(objectCount, 1)} objects`)
      list.push(
        <Badge
          key="objects"
          variant="secondary"
          className="h-5 gap-1 px-1.5 text-[11px]"
          title={t('messages.containsObjects', 'Contains attached objects')}
        >
          <FileText className="h-3 w-3" />
          <span>{label}</span>
        </Badge>,
      )
    }

    if (message.hasAttachments) {
      const label = t('messages.attachmentsCount', `${Math.max(attachmentCount, 1)} attachments`)
      list.push(
        <Badge
          key="attachments"
          variant="secondary"
          className="h-5 gap-1 px-1.5 text-[11px]"
          title={t('messages.containsAttachments', 'Contains file attachments')}
        >
          <Paperclip className="h-3 w-3" />
          <span>{label}</span>
        </Badge>,
      )
    }

    return list
  }, [
    attachmentCount,
    message.actionTaken,
    message.hasActions,
    message.hasAttachments,
    message.hasObjects,
    message.priority,
    objectCount,
    t,
  ])

  const visibleChips = chips.slice(0, 3)
  const hiddenChipCount = chips.length - visibleChips.length

  return (
    <div
      className={cn(
        "group min-w-0 w-full cursor-pointer rounded-md p-3 transition-colors hover:bg-muted/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        message.unread && "border-l-2 border-l-primary bg-muted/20",
      )}
      role="button"
      tabIndex={0}
      aria-label={t(
        'messages.openMessageA11y',
        `Open message ${message.subject} from ${senderLabel}, sent ${absoluteSentAt}`,
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge
            variant="outline"
            className="mb-1 h-5 px-1.5 text-[11px] font-medium normal-case"
            title={t('messages.typeLabel', 'Message type')}
          >
            {messageTypeLabel}
          </Badge>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <p className={cn('min-w-0 text-sm', message.unread ? 'font-semibold' : 'font-medium')}>
          <span className="mr-1 text-xs font-medium tracking-wide text-muted-foreground">
            {t('messages.subjectLabel', 'Subject:')}
          </span>
          <span className="truncate">{message.subject || '—'}</span>
        </p>
        <span
          className="flex-shrink-0 text-xs text-muted-foreground"
          title={absoluteSentAt}
        >
          {relativeSentAt}
        </span>
      </div>

      <p className="truncate text-xs text-muted-foreground">
        <span className="mr-1 font-medium tracking-wide text-muted-foreground">
          {t('messages.bodyLabel', 'Body:')}
        </span>
        <span>{bodyPreview}</span>
      </p>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-2">
          {message.unread && (
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full bg-primary"
              title={t('messages.status.unread', 'Unread')}
            />
          )}
          <span className="truncate">
            <span className="mr-1 font-medium tracking-wide text-muted-foreground">
              {t('messages.authorLabel', 'Author:')}
            </span>
            <span>{senderLabel}</span>
          </span>
        </span>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <span className="flex flex-shrink-0 items-center gap-1.5">
          {visibleChips}
          {hiddenChipCount > 0 && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
              +{hiddenChipCount}
            </Badge>
          )}
        </span>
      </div>
    </div>
  )
}

export default DefaultMessageListItem
