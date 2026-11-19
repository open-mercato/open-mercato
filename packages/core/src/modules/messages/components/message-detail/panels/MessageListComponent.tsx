"use client"

import type { MessageListItemProps } from '@open-mercato/shared/modules/messages/types'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayTime, todayInZone } from '@open-mercato/ui/primitives/date-format'
import { resolveDisplayTimeZone, useDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-settings'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'

function formatSentTime(
  value: Date | null,
  unknownDate: string,
  locale: string,
  settings: ResolvedDateLocaleSettings,
): string {
  if (!value || Number.isNaN(value.getTime())) return unknownDate

  const timeZone = resolveDisplayTimeZone(settings)
  if (todayInZone(timeZone) === todayInZone(timeZone, value)) {
    return formatDisplayTime(value, locale, settings) ?? unknownDate
  }

  return value.toLocaleDateString(settings.locale ?? locale, { month: 'short', day: 'numeric', timeZone })
}

function normalizeBody(value: string | null): string {
  const normalized = (value ?? '').trim().replace(/\s+/g, ' ')
  return normalized || '—'
}

export function MessageListComponent({ message, onClick }: MessageListItemProps) {
  const t = useT()
  const locale = useLocale()
  const dateLocaleSettings = useDateLocaleSettings()
  const senderLabel = message.senderName || '—'
  const body = normalizeBody(message.body)
  const sentAtLabel = message.isDraft
    ? '—'
    : formatSentTime(message.sentAt, t('messages.unknownDate', 'Unknown date'), locale, dateLocaleSettings)

  return (
    <div
      className={cn(
        'group min-w-0 w-full cursor-pointer rounded-md px-2 py-2 transition-colors hover:bg-muted/50',
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
