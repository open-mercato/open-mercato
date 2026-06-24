"use client"

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { formatTimeRange } from './EventBlock'
import type { CalendarItem, CalendarPlatform } from './types'

const PLATFORM_FULL_LABELS: Record<CalendarPlatform, { key: string; fallback: string }> = {
  zoom: { key: 'customers.calendar.platformFull.zoom', fallback: 'Zoom' },
  meet: { key: 'customers.calendar.platformFull.meet', fallback: 'Google Meet' },
  slack: { key: 'customers.calendar.platformFull.slack', fallback: 'Slack' },
  teams: { key: 'customers.calendar.platformFull.teams', fallback: 'Microsoft Teams' },
}

export type EventPeekPopoverProps = {
  item: CalendarItem
  open: boolean
  joinUrl: string | null
  aiSummaries: boolean
  onOpenChange(open: boolean): void
  onJoin(item: CalendarItem): void
  onEdit(item: CalendarItem): void
  children: React.ReactNode
}

export function EventPeekPopover({
  item,
  open,
  joinUrl,
  aiSummaries,
  onOpenChange,
  onJoin,
  onEdit,
  children,
}: EventPeekPopoverProps) {
  const t = useT()
  const locale = useLocale()
  const title = item.title || t('customers.calendar.grid.untitled', 'Untitled')
  const dateLabel = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(item.start),
    [locale, item.start],
  )
  const timeRange = item.allDay
    ? t('customers.calendar.grid.allDay', 'All day')
    : formatTimeRange(locale, item.start, item.end)

  const attendeeCount = item.participants.length
  const attendeesLabel =
    attendeeCount === 1
      ? t('customers.calendar.peek.attendee', '1 attendee')
      : t('customers.calendar.peek.attendees', '{count} attendees', { count: attendeeCount })
  const platformLabel =
    item.locationKind === 'platform' && item.platform
      ? t(PLATFORM_FULL_LABELS[item.platform].key, PLATFORM_FULL_LABELS[item.platform].fallback)
      : null
  const metaParts = [platformLabel, attendeeCount > 0 ? attendeesLabel : null].filter(
    (part): part is string => Boolean(part),
  )
  const showSummary = aiSummaries && metaParts.length > 0
  const showJoin = aiSummaries && Boolean(joinUrl)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="right" sideOffset={8} className="w-56 p-3">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold leading-5 text-foreground">{title}</p>
          <p className="text-xs leading-4 text-muted-foreground">{`${dateLabel} · ${timeRange}`}</p>
          {showSummary ? (
            <p className="flex items-center gap-1 text-xs leading-4 text-muted-foreground">
              <Sparkles aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{metaParts.join(' · ')}</span>
            </p>
          ) : null}
          <div className="flex items-center gap-2 pt-1">
            {showJoin ? (
              <Button type="button" size="sm" onClick={() => onJoin(item)}>
                {t('customers.calendar.peek.join', 'Join')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                onOpenChange(false)
                onEdit(item)
              }}
            >
              {t('customers.calendar.peek.edit', 'Edit')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
