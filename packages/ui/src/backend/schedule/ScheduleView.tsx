"use client"

import * as React from 'react'
import { Calendar, dateFnsLocalizer, type View, type SlotInfo } from 'react-big-calendar'
import { addDays, differenceInCalendarDays, endOfDay, endOfMonth, endOfWeek, format, getDay, parse, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import enUS from 'date-fns/locale/en-US'
import type { ScheduleItem, ScheduleRange, ScheduleSlot, ScheduleViewMode } from './types'
import { ScheduleToolbar } from './ScheduleToolbar'

type CalendarEvent = {
  id: string
  title: string
  start: Date
  end: Date
  resource: ScheduleItem
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { 'en-US': enUS },
})

const VIEW_MAP: Record<ScheduleViewMode, View> = {
  day: 'day',
  week: 'week',
  month: 'month',
  agenda: 'agenda',
}

function deriveRange(date: Date, view: ScheduleViewMode, agendaLength: number): ScheduleRange {
  if (view === 'day') {
    return { start: startOfDay(date), end: endOfDay(date) }
  }
  if (view === 'week') {
    return { start: startOfWeek(date, { locale: enUS }), end: endOfWeek(date, { locale: enUS }) }
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
): ScheduleRange | null {
  if (!nextRange) return null
  if (Array.isArray(nextRange)) {
    if (nextRange.length === 0) return null
    if (view === 'agenda') {
      return { start: nextRange[0], end: nextRange[nextRange.length - 1] }
    }
    return deriveRange(nextRange[0], view, agendaLength)
  }
  if (nextRange.start && nextRange.end) return { start: nextRange.start, end: nextRange.end }
  return deriveRange(new Date(), view, agendaLength)
}

function getEventStyles(item: ScheduleItem): React.CSSProperties {
  if (item.kind === 'event') {
    return { backgroundColor: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.5)', color: '#1e3a8a' }
  }
  if (item.kind === 'exception') {
    return { backgroundColor: 'rgba(148, 163, 184, 0.2)', border: '1px solid rgba(100, 116, 139, 0.6)', color: '#334155' }
  }
  return { backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.5)', color: '#064e3b' }
}

export type ScheduleViewProps = {
  items: ScheduleItem[]
  view: ScheduleViewMode
  range: ScheduleRange
  timezone?: string
  onRangeChange: (range: ScheduleRange) => void
  onViewChange: (view: ScheduleViewMode) => void
  onItemClick?: (item: ScheduleItem) => void
  onSlotClick?: (slot: ScheduleSlot) => void
  onTimezoneChange?: (timezone: string) => void
  className?: string
}

export function ScheduleView({
  items,
  view,
  range,
  timezone,
  onRangeChange,
  onViewChange,
  onItemClick,
  onSlotClick,
  onTimezoneChange,
  className,
}: ScheduleViewProps) {
  const agendaLength = React.useMemo(
    () => Math.max(1, differenceInCalendarDays(range.end, range.start) + 1),
    [range.end, range.start],
  )
  const currentView = VIEW_MAP[view]
  const events = React.useMemo<CalendarEvent[]>(
    () => items.map((item) => ({
      id: item.id,
      title: item.title,
      start: item.startsAt,
      end: item.endsAt,
      resource: item,
    })),
    [items],
  )

  const handleNavigate = React.useCallback((date: Date, nextView?: View) => {
    const resolvedView = (nextView ?? currentView) as ScheduleViewMode
    onRangeChange(deriveRange(date, resolvedView, agendaLength))
  }, [agendaLength, currentView, onRangeChange])

  const handleRangeChange = React.useCallback((nextRange: Date[] | { start: Date; end: Date }, nextView?: View) => {
    const resolvedView = (nextView ?? currentView) as ScheduleViewMode
    const normalized = normalizeRange(nextRange, resolvedView, agendaLength)
    if (normalized) onRangeChange(normalized)
  }, [agendaLength, currentView, onRangeChange])

  const handleViewChange = React.useCallback((nextView: View) => {
    const resolved = nextView as ScheduleViewMode
    if (resolved !== view) onViewChange(resolved)
  }, [onViewChange, view])

  const rootClassName = ['schedule-view', className].filter(Boolean).join(' ')

  return (
    <div className={rootClassName}>
      <ScheduleToolbar
        view={view}
        range={range}
        timezone={timezone}
        onRangeChange={onRangeChange}
        onViewChange={onViewChange}
        onTimezoneChange={onTimezoneChange}
      />
      <div className="schedule-calendar mt-4 rounded-xl border bg-card p-3">
        <Calendar
          localizer={localizer}
          culture="en-US"
          events={events}
          view={currentView}
          date={range.start}
          toolbar={false}
          selectable={Boolean(onSlotClick)}
          popup
          length={agendaLength}
          onView={handleViewChange}
          onNavigate={handleNavigate}
          onRangeChange={handleRangeChange}
          onSelectEvent={(event) => onItemClick?.((event as CalendarEvent).resource)}
          onSelectSlot={(slot) => {
            if (!onSlotClick) return
            const info = slot as SlotInfo
            onSlotClick({ start: info.start, end: info.end })
          }}
          eventPropGetter={(event) => ({
            style: getEventStyles((event as CalendarEvent).resource),
          })}
          components={{
            event: ({ event }) => {
              const resource = (event as CalendarEvent).resource
              const hasLink = Boolean(resource.linkLabel) && typeof onItemClick === 'function'
              return (
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">{resource.title}</span>
                  {hasLink ? (
                    <button
                      type="button"
                      className="text-[11px] font-medium underline-offset-2 hover:underline"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation()
                        onItemClick?.(resource)
                      }}
                    >
                      {resource.linkLabel}
                    </button>
                  ) : null}
                </div>
              )
            },
          }}
          style={{ height: 640 }}
        />
      </div>
    </div>
  )
}
