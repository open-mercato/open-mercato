"use client"

import * as React from 'react'
import { addDays } from 'date-fns/addDays'
import { format } from 'date-fns/format'
import { isToday } from 'date-fns/isToday'
import { isTomorrow } from 'date-fns/isTomorrow'
import { startOfDay } from 'date-fns/startOfDay'
import { CalendarClock } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { eventDisplayTitle, pluralCategory } from '../../lib/calendar/labels'
import type { AgendaListProps, CalendarCategory, CalendarItem } from './types'

const MAX_AVATARS_PER_ROW = 2

const CATEGORY_BADGE_CLASS: Record<CalendarCategory, string> = {
  meeting: 'bg-status-info-bg text-status-info-text',
  event: 'bg-status-warning-bg text-status-warning-text',
  task: 'bg-primary text-primary-foreground',
  other: 'bg-status-neutral-bg text-status-neutral-text',
}

const CATEGORY_LABEL: Record<CalendarCategory, { key: string; fallback: string }> = {
  meeting: { key: 'customers.calendar.category.meeting', fallback: 'Meeting' },
  event: { key: 'customers.calendar.category.event', fallback: 'Event' },
  task: { key: 'customers.calendar.category.task', fallback: 'Task' },
  other: { key: 'customers.calendar.category.other', fallback: 'Other' },
}

type AgendaDayGroup = { date: Date; items: CalendarItem[] }

function dayKeyOf(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function formatUrlHost(location: string): string {
  try {
    const url = new URL(location.startsWith('http') ? location : `https://${location}`)
    return url.hostname
  } catch {
    return location
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function groupLabelOf(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function deriveTypeLabel(interactionType: string): string {
  const normalized = interactionType.replace(/[-_]+/g, ' ').trim()
  if (!normalized) return interactionType
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function participantLabel(participant: CalendarItem['participants'][number]): string {
  return participant.name ?? participant.email ?? participant.userId
}

function buildDayGroups(anchor: Date, horizonDays: number, items: CalendarItem[]): AgendaDayGroup[] {
  const sorted = [...items].sort((first, second) => first.start.getTime() - second.start.getTime())
  const byDay = new Map<string, CalendarItem[]>()
  for (const item of sorted) {
    const key = dayKeyOf(item.start)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(item)
    else byDay.set(key, [item])
  }
  const firstDay = startOfDay(anchor)
  const groups: AgendaDayGroup[] = []
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const day = addDays(firstDay, offset)
    const dayItems = byDay.get(dayKeyOf(day))
    if (dayItems && dayItems.length > 0) groups.push({ date: day, items: dayItems })
  }
  return groups
}

function AgendaDayHeader({ date, count }: { date: Date; count: number }) {
  const t = useT()
  const locale = useLocale()
  const todayMarker = isToday(date)
  const tomorrowMarker = !todayMarker && isTomorrow(date)
  const countKey = `customers.calendar.agenda.eventsCount.${pluralCategory(locale, count)}`
  const resolvedCount = t(countKey, { count })
  const countLabel =
    resolvedCount === countKey
      ? t('customers.calendar.agenda.eventsCount.other', '{count} events', { count })
      : resolvedCount
  return (
    <div className="flex w-full items-center gap-2 bg-muted/50 px-3 py-2.5 sm:px-5">
      <span className="text-sm font-semibold text-foreground">{groupLabelOf(date)}</span>
      {todayMarker || tomorrowMarker ? (
        <span className={cn('text-xs font-medium', todayMarker ? 'text-foreground' : 'text-muted-foreground')}>
          {`· ${todayMarker ? t('customers.calendar.agenda.today', 'Today') : t('customers.calendar.agenda.tomorrow', 'Tomorrow')}`}
        </span>
      ) : null}
      <span aria-hidden="true" className="w-2.5 shrink-0" />
      <span className="text-xs font-medium text-muted-foreground">{countLabel}</span>
    </div>
  )
}

function AgendaRow({
  item,
  typeLabels,
  onItemClick,
}: {
  item: CalendarItem
  typeLabels?: Record<string, string>
  onItemClick: (item: CalendarItem) => void
}) {
  const t = useT()
  const canceled = item.status === 'canceled'
  const done = item.status === 'done'
  const title = eventDisplayTitle(item.title, t('customers.calendar.grid.untitled', 'Untitled'))
  const typeLabel = typeLabels?.[item.interactionType] ?? deriveTypeLabel(item.interactionType)
  const platformLabels: Record<string, string> = {
    zoom: t('customers.calendar.platformFull.zoom', 'Zoom'),
    meet: t('customers.calendar.platformFull.meet', 'Google Meet'),
    slack: t('customers.calendar.platformFull.slack', 'Slack'),
    teams: t('customers.calendar.platformFull.teams', 'Microsoft Teams'),
  }
  const locationLabel = item.platform
    ? platformLabels[item.platform]
    : item.locationKind === 'url' && item.location
      ? formatUrlHost(item.location)
      : item.location
  const startLabel = item.allDay ? t('customers.calendar.grid.allDay', 'All day') : formatTime(item.start)
  const endLabel = item.allDay ? null : formatTime(item.end)
  const ariaTime = item.allDay ? startLabel : `${startLabel} – ${endLabel}`
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={`${title} · ${ariaTime}`}
      onClick={() => onItemClick(item)}
      className={cn(
        'h-auto w-full justify-start whitespace-normal rounded-none bg-background px-3 py-3 text-left transition-colors hover:bg-muted/30 sm:gap-3.5 sm:px-5',
        canceled && 'opacity-60',
      )}
    >
      <div className="flex w-16 shrink-0 flex-col gap-0.5 sm:w-[86px]">
        <span className={cn('truncate text-sm font-semibold leading-4', done || canceled ? 'text-muted-foreground' : 'text-foreground')}>
          {startLabel}
        </span>
        {endLabel ? <span className="truncate text-xs text-muted-foreground">{endLabel}</span> : null}
      </div>
      <span
        aria-hidden="true"
        className={cn('h-9 w-1 shrink-0 rounded-full', !item.color && 'bg-muted-foreground/40')}
        style={item.color ? { backgroundColor: item.color } : undefined}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-sm font-semibold',
            done || canceled ? 'text-muted-foreground' : 'text-foreground',
            canceled && 'line-through',
          )}
        >
          {title}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {locationLabel ? `${typeLabel} · ${locationLabel}` : typeLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.participants.length > 0 ? (
          <span className="hidden items-center gap-0.5 sm:flex">
            {item.participants.slice(0, MAX_AVATARS_PER_ROW).map((participant) => (
              <Avatar key={participant.userId} size="xs" label={participantLabel(participant)} />
            ))}
            {item.participants.length > MAX_AVATARS_PER_ROW ? (
              <span className="ps-0.5 text-xs font-medium text-muted-foreground">
                +{item.participants.length - MAX_AVATARS_PER_ROW}
              </span>
            ) : null}
          </span>
        ) : null}
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-overline font-medium uppercase tracking-wide',
            CATEGORY_BADGE_CLASS[item.category],
          )}
        >
          {t(CATEGORY_LABEL[item.category].key, CATEGORY_LABEL[item.category].fallback)}
        </span>
      </div>
    </Button>
  )
}

export function AgendaList({ anchor, horizonDays, items, typeLabels, onItemClick }: AgendaListProps) {
  const t = useT()
  const groups = React.useMemo(() => buildDayGroups(anchor, horizonDays, items), [anchor, horizonDays, items])
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock className="h-6 w-6" aria-hidden="true" />}
        title={t('customers.calendar.empty.agenda', 'Nothing scheduled in this period')}
      />
    )
  }
  return (
    <div className="flex w-full flex-col divide-y divide-border overflow-hidden border border-border bg-background">
      {groups.map((group) => (
        <React.Fragment key={dayKeyOf(group.date)}>
          <AgendaDayHeader date={group.date} count={group.items.length} />
          {group.items.map((item) => (
            <AgendaRow key={item.id} item={item} typeLabels={typeLabels} onItemClick={onItemClick} />
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}
