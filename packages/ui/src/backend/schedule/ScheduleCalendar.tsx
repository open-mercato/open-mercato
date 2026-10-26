"use client"

import 'react-big-calendar/lib/css/react-big-calendar.css'
import * as React from 'react'
import { Calendar, dateFnsLocalizer, type View, type SlotInfo } from 'react-big-calendar'
import { addDays } from 'date-fns/addDays'
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays'
import { endOfDay } from 'date-fns/endOfDay'
import { endOfMonth } from 'date-fns/endOfMonth'
import { endOfWeek } from 'date-fns/endOfWeek'
import { format } from 'date-fns/format'
import { getDay } from 'date-fns/getDay'
import { parse } from 'date-fns/parse'
import { startOfDay } from 'date-fns/startOfDay'
import { startOfMonth } from 'date-fns/startOfMonth'
import { startOfWeek } from 'date-fns/startOfWeek'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { getScheduleLocale, scheduleLocales } from './localization'
import type { ScheduleItem, ScheduleRange, ScheduleSlot, ScheduleViewMode } from './types'
import { Button } from '../../primitives/button'
import { expandRecurringItems } from './recurrence'
import { getScheduleItemStyle } from './presentation'

type CalendarEvent = {
  id: string
  title: string
  start: Date
  end: Date
  resource: ScheduleItem
  allDay: boolean
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: scheduleLocales,
})

const VIEW_MAP: Record<ScheduleViewMode, View> = {
  day: 'day',
  week: 'week',
  month: 'month',
  agenda: 'agenda',
}

function deriveRange(date: Date, view: ScheduleViewMode, agendaLength: number, locale: string): ScheduleRange {
  if (view === 'day') {
    return { start: startOfDay(date), end: endOfDay(date) }
  }
  if (view === 'week') {
    return { start: startOfWeek(date, { locale: getScheduleLocale(locale) }), end: endOfWeek(date, { locale: getScheduleLocale(locale) }) }
  }
  if (view === 'month') {
    return { start: startOfMonth(date), end: endOfMonth(date) }
  }
  const length = Math.max(1, agendaLength)
  return { start: startOfDay(date), end: endOfDay(addDays(date, length - 1)) }
}

function normalizeRange(
  nextRange: Date[] | { start: Date; end: Date } | null | undefined,
  view: ScheduleViewMode,
  agendaLength: number,
  locale: string,
): ScheduleRange | null {
  if (!nextRange) return null
  if (Array.isArray(nextRange)) {
    if (nextRange.length === 0) return null
    if (view === 'agenda') {
      return { start: nextRange[0], end: nextRange[nextRange.length - 1] }
    }
    return deriveRange(nextRange[0], view, agendaLength, locale)
  }
  if (nextRange.start && nextRange.end) return { start: nextRange.start, end: nextRange.end }
  return deriveRange(new Date(), view, agendaLength, locale)
}

function isAllDay(item: ScheduleItem): boolean {
  return item.startsAt.getTime() === startOfDay(item.startsAt).getTime()
    && item.endsAt.getTime() >= endOfDay(item.startsAt).getTime() - 60_000
}

export type ScheduleCalendarProps = {
  items: ScheduleItem[]
  view: ScheduleViewMode
  range: ScheduleRange
  onRangeChange: (range: ScheduleRange) => void
  onViewChange: (view: ScheduleViewMode) => void
  onItemClick?: (item: ScheduleItem) => void
  onSlotClick?: (slot: ScheduleSlot) => void
}

export default function ScheduleCalendar({
  items,
  view,
  range,
  onRangeChange,
  onViewChange,
  onItemClick,
  onSlotClick,
}: ScheduleCalendarProps) {
  const locale = useOptionalLocale() ?? 'en'
  const t = useT()
  const agendaLength = React.useMemo(
    () => Math.max(1, differenceInCalendarDays(range.end, range.start) + 1),
    [range.end, range.start],
  )
  const currentView = VIEW_MAP[view]
  const expandedItems = React.useMemo(() => expandRecurringItems(items, range), [items, range])
  const events = React.useMemo<CalendarEvent[]>(
    () => expandedItems.map((item) => ({
      id: item.id,
      title: item.title,
      start: item.startsAt,
      end: item.endsAt,
      resource: item,
      allDay: isAllDay(item),
    })),
    [expandedItems],
  )

  const handleNavigate = React.useCallback((date: Date, nextView?: View) => {
    const resolvedView = (nextView ?? currentView) as ScheduleViewMode
    onRangeChange(deriveRange(date, resolvedView, agendaLength, locale))
  }, [agendaLength, currentView, locale, onRangeChange])

  const handleRangeChange = React.useCallback((nextRange: Date[] | { start: Date; end: Date }, nextView?: View) => {
    const resolvedView = (nextView ?? currentView) as ScheduleViewMode
    const normalized = normalizeRange(nextRange, resolvedView, agendaLength, locale)
    if (normalized) onRangeChange(normalized)
  }, [agendaLength, currentView, locale, onRangeChange])

  const handleViewChange = React.useCallback((nextView: View) => {
    const resolved = nextView as ScheduleViewMode
    if (resolved !== view) {
      onViewChange(resolved)
      onRangeChange(deriveRange(range.start, resolved, agendaLength, locale))
    }
  }, [agendaLength, locale, onRangeChange, onViewChange, range.start, view])

  const handleSelectEvent = React.useCallback(
    (event: CalendarEvent) => onItemClick?.(event.resource),
    [onItemClick],
  )

  const handleSelectSlot = React.useCallback(
    (slot: SlotInfo) => {
      if (!onSlotClick) return
      onSlotClick({ start: slot.start, end: slot.end })
    },
    [onSlotClick],
  )

  const eventPropGetter = React.useCallback(
    (event: CalendarEvent) => ({ className: `schedule-event schedule-event-${event.resource.kind}`, style: getScheduleItemStyle(event.resource) }),
    [],
  )

  const scrollToTime = React.useMemo(() => new Date(1970, 0, 1, 8), [])

  const components = React.useMemo(
    () => ({
      timeGutterHeader: () => (
        <div className="flex h-full items-end justify-center pb-3 text-xs text-muted-foreground">{t('schedule.calendar.allDay')}</div>
      ),
      month: {
        header: ({ date }: { date: Date }) => (
          <span className="block py-2 text-xs font-medium text-muted-foreground">{format(date, 'EEEEEE', { locale: getScheduleLocale(locale) })}</span>
        ),
      },
      header: ({ date }: { date: Date }) => (
        <time dateTime={format(date, 'yyyy-MM-dd')} className="flex flex-col items-center gap-1 py-2">
          <span className="text-xs font-medium text-muted-foreground">{format(date, 'EEE', { locale: getScheduleLocale(locale) })}</span>
          <span className="text-lg font-semibold text-foreground">{format(date, 'd')}</span>
        </time>
      ),
      event: ({ event }: { event: CalendarEvent }) => {
        const resource = event.resource
        const hasLink = Boolean(resource.linkLabel) && typeof onItemClick === 'function'
        return (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span className="line-clamp-2 text-sm font-semibold leading-tight">{resource.title}</span>
            {hasLink ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-current"
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation()
                  onItemClick?.(resource)
                }}
              >
                {resource.linkLabel}
              </Button>
            ) : null}
          </div>
        )
      },
    }),
    [locale, onItemClick, t],
  )

  const formats = React.useMemo(() => ({
    timeGutterFormat: (date: Date) => format(date, 'HH:mm'),
    eventTimeRangeFormat: ({ start, end }: { start: Date; end: Date }) => `${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`,
    agendaTimeRangeFormat: ({ start, end }: { start: Date; end: Date }) => `${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`,
  }), [])

  return (
    <Calendar
      localizer={localizer}
      culture={locale}
      className="schedule-calendar-surface"
      formats={formats}
      messages={{
        allDay: t('schedule.calendar.allDay'),
        noEventsInRange: t('schedule.calendar.empty'),
        showMore: (count: number) => t('schedule.calendar.showMore', undefined, { count }),
      }}
      scrollToTime={scrollToTime}
      events={events}
      tooltipAccessor={(event: CalendarEvent) => event.resource.status
        ? `${event.title} · ${t(`schedule.item.status.${event.resource.status}`)}`
        : event.title}
      view={currentView}
      date={range.start}
      toolbar={false}
      selectable={Boolean(onSlotClick)}
      popup
      length={agendaLength}
      onView={handleViewChange}
      onNavigate={handleNavigate}
      onRangeChange={handleRangeChange}
      onSelectEvent={handleSelectEvent}
      onSelectSlot={handleSelectSlot}
      eventPropGetter={eventPropGetter}
      components={components}
    />
  )
}
