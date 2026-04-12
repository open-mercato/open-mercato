'use client'

import * as React from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { InteractionSummary, ActivitySummary } from './types'

interface MiniWeekCalendarProps {
  entityId: string
  useCanonicalInteractions?: boolean
  refreshRef?: React.RefObject<(() => void) | null>
}

function getWeekDays(baseDate: Date): Date[] {
  const day = baseDate.getDay()
  const monday = new Date(baseDate)
  monday.setDate(baseDate.getDate() - ((day === 0 ? 7 : day) - 1))
  monday.setHours(0, 0, 0, 0)
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    days.push(d)
  }
  return days
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function getDayLabels(t: ReturnType<typeof useT>): string[] {
  return [
    t('customers.calendar.day.mon', 'MON'),
    t('customers.calendar.day.tue', 'TUE'),
    t('customers.calendar.day.wed', 'WED'),
    t('customers.calendar.day.thu', 'THU'),
    t('customers.calendar.day.fri', 'FRI'),
    t('customers.calendar.day.sat', 'SAT'),
    t('customers.calendar.day.sun', 'SUN'),
  ]
}

const INTERACTION_TYPE_COLORS: Record<string, string> = {
  call: 'bg-orange-500',
  email: 'bg-blue-500',
  meeting: 'bg-emerald-500',
  task: 'bg-violet-500',
  note: 'bg-gray-400',
}

function dotColorForType(type: string, isToday: boolean): string {
  if (isToday) return 'bg-background'
  return INTERACTION_TYPE_COLORS[type] ?? 'bg-orange-500'
}

export function MiniWeekCalendar({ entityId, useCanonicalInteractions = true, refreshRef }: MiniWeekCalendarProps) {
  const t = useT()
  const today = React.useMemo(() => new Date(), [])
  const [weekOffset, setWeekOffset] = React.useState(0)
  const [events, setEvents] = React.useState<InteractionSummary[]>([])

  const baseDate = React.useMemo(() => {
    const d = new Date(today)
    d.setDate(d.getDate() + weekOffset * 7)
    return d
  }, [today, weekOffset])

  const weekDays = React.useMemo(() => getWeekDays(baseDate), [baseDate])
  const weekStart = weekDays[0]
  const weekEnd = weekDays[6]

  const monthLabel = React.useMemo(() => {
    const month = baseDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    return weekOffset === 0
      ? t('customers.calendar.thisWeek', 'This week') + ' — ' + month
      : month
  }, [baseDate, t, weekOffset])

  const [refreshKey, setRefreshKey] = React.useState(0)
  const refresh = React.useCallback(() => setRefreshKey((k) => k + 1), [])

  React.useEffect(() => {
    if (refreshRef) (refreshRef as React.MutableRefObject<(() => void) | null>).current = refresh
  }, [refresh, refreshRef])

  React.useEffect(() => {
    if (!entityId) return
    const controller = new AbortController()
    const from = weekStart.toISOString().slice(0, 10)
    const toDate = new Date(weekEnd)
    toDate.setDate(toDate.getDate() + 2)
    const to = toDate.toISOString().slice(0, 10)

    function filterByDateRange(items: InteractionSummary[]): InteractionSummary[] {
      return items.filter((item) => {
        const d = (item.scheduledAt ?? item.occurredAt ?? item.createdAt ?? '').slice(0, 10)
        return d >= from && d <= to
      })
    }

    // Don't use from/to API params — the API only filters on scheduled_at which is null for logged activities.
    // Fetch all and filter client-side.
    const canonicalUrl = `/api/customers/interactions?entityId=${encodeURIComponent(entityId)}&sortField=occurredAt&sortDir=asc&limit=50&excludeInteractionType=task`

    if (useCanonicalInteractions) {
      readApiResultOrThrow<{ items?: InteractionSummary[] }>(canonicalUrl, { signal: controller.signal })
        .then((data) => setEvents(filterByDateRange(Array.isArray(data?.items) ? data.items : [])))
        .catch(() => {})
    } else {
      // Fetch both canonical + legacy and merge
      Promise.all([
        readApiResultOrThrow<{ items?: InteractionSummary[] }>(canonicalUrl, { signal: controller.signal })
          .catch(() => ({ items: [] as InteractionSummary[] })),
        readApiResultOrThrow<{ items?: ActivitySummary[] }>(
          `/api/customers/activities?entityId=${encodeURIComponent(entityId)}&pageSize=50&sortField=occurredAt&sortDir=asc`,
          { signal: controller.signal },
        ).catch(() => ({ items: [] as ActivitySummary[] })),
      ]).then(([canonical, legacy]) => {
        const canonicalItems = Array.isArray(canonical?.items) ? canonical.items : []
        const legacyRaw = Array.isArray(legacy?.items) ? legacy.items : []
        const legacyMapped: InteractionSummary[] = legacyRaw.map((a) => ({
          id: a.id,
          interactionType: a.activityType,
          title: a.subject ?? null,
          body: a.body ?? null,
          status: 'done',
          scheduledAt: null,
          occurredAt: a.occurredAt ?? null,
          priority: null,
          authorUserId: a.authorUserId ?? null,
          ownerUserId: null,
          appearanceIcon: a.appearanceIcon ?? null,
          appearanceColor: a.appearanceColor ?? null,
          source: 'legacy-activity',
          entityId: a.entityId ?? null,
          dealId: a.dealId ?? null,
          organizationId: null,
          tenantId: null,
          authorName: a.authorName ?? null,
          authorEmail: a.authorEmail ?? null,
          dealTitle: a.dealTitle ?? null,
          customValues: null,
          createdAt: a.createdAt,
          updatedAt: a.createdAt,
        }))
        const seen = new Set<string>()
        const merged: InteractionSummary[] = []
        for (const item of [...canonicalItems, ...legacyMapped]) {
          if (!seen.has(item.id)) {
            seen.add(item.id)
            merged.push(item)
          }
        }
        setEvents(filterByDateRange(merged))
      }).catch(() => {})
    }
    return () => controller.abort()
  }, [entityId, weekStart, weekEnd, useCanonicalInteractions, refreshKey])

  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, InteractionSummary[]>()
    for (const event of events) {
      const dateStr = event.scheduledAt ?? event.occurredAt ?? event.createdAt
      if (!dateStr) continue
      const key = new Date(dateStr).toDateString()
      const list = map.get(key) ?? []
      list.push(event)
      map.set(key, list)
    }
    return map
  }, [events])

  // Selected day for summary (defaults to today)
  const [selectedDay, setSelectedDay] = React.useState<Date | null>(null)
  const activeDay = selectedDay ?? today

  // Collect events for the active day + tomorrow for the summary list
  const summaryEvents = React.useMemo(() => {
    const result: Array<{ event: InteractionSummary; dayLabel: string; isToday: boolean }> = []
    for (let offset = 0; offset <= 2 && result.length < 3; offset++) {
      const d = new Date(activeDay)
      d.setDate(d.getDate() + offset)
      const dayEvents = eventsByDay.get(d.toDateString()) ?? []
      const isActiveDay = offset === 0
      const label = isActiveDay
        ? ''
        : offset === 1
          ? t('customers.calendar.tomorrow', 'Tomorrow') + ' '
          : d.toLocaleDateString(undefined, { weekday: 'short' }) + ' '
      for (const ev of dayEvents) {
        if (result.length >= 3) break
        result.push({ event: ev, dayLabel: label, isToday: isActiveDay })
      }
    }
    return result
  }, [eventsByDay, activeDay, t])

  const dayLabels = getDayLabels(t)

  return (
    <div className="rounded-lg border border-border/60 p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Calendar className="size-4 text-muted-foreground" />
          {monthLabel}
        </div>
        <div className="flex items-center gap-1">
          <IconButton type="button" variant="ghost" size="xs" onClick={() => setWeekOffset((w) => w - 1)} aria-label={t('customers.calendar.previousWeek', 'Previous week')}>
            <ChevronLeft className="size-3.5" />
          </IconButton>
          <IconButton type="button" variant="ghost" size="xs" onClick={() => setWeekOffset((w) => w + 1)} aria-label={t('customers.calendar.nextWeek', 'Next week')}>
            <ChevronRight className="size-3.5" />
          </IconButton>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {dayLabels.map((label) => (
          <div key={label} className="text-center text-[10px] font-medium text-muted-foreground">
            {label}
          </div>
        ))}
      </div>

      {/* Day cells — bordered grid like Figma */}
      <div className="grid grid-cols-7 border rounded-lg overflow-hidden">
        {weekDays.map((day) => {
          const isToday = isSameDay(day, today)
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : isToday
          const dayEvents = eventsByDay.get(day.toDateString()) ?? []
          const hasEvents = dayEvents.length > 0
          return (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              key={day.toISOString()}
              onClick={() => setSelectedDay(isSameDay(day, selectedDay ?? today) ? null : day)}
              className={cn(
                'h-auto flex flex-col items-center border-r last:border-r-0 py-3 text-sm transition-colors cursor-pointer rounded-none',
                isSelected ? 'bg-foreground text-background font-bold' : 'hover:bg-accent/50',
              )}
            >
              <span className="text-base">{day.getDate()}</span>
              {hasEvents && (
                <div className="mt-1 flex gap-0.5">
                  {dayEvents.slice(0, 3).map((ev, i) => (
                    <span
                      key={i}
                      className={cn(
                        'size-1 rounded-full',
                        dotColorForType(ev.interactionType, isSelected),
                      )}
                    />
                  ))}
                </div>
              )}
            </Button>
          )
        })}
      </div>

      {/* Day summary — events for selected/active day + upcoming */}
      {summaryEvents.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t pt-3">
          {summaryEvents.map(({ event, dayLabel, isToday: isActiveDay }) => {
            const dateStr = event.scheduledAt ?? event.occurredAt ?? event.createdAt
            const time = dateStr ? new Date(dateStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''
            return (
              <div key={event.id} className="flex items-center gap-2 text-xs">
                <span className={cn('size-1.5 rounded-full shrink-0', INTERACTION_TYPE_COLORS[event.interactionType] ?? (isActiveDay ? 'bg-orange-500' : 'bg-muted-foreground'))} />
                <span className="font-semibold text-muted-foreground shrink-0">
                  {dayLabel}{time}
                </span>
                <span className="truncate">{event.title ?? event.body ?? event.interactionType}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
