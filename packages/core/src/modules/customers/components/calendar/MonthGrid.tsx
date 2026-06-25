"use client"

import * as React from 'react'
import { addDays } from 'date-fns/addDays'
import { format } from 'date-fns/format'
import { isSameMonth } from 'date-fns/isSameMonth'
import { isToday } from 'date-fns/isToday'
import { CalendarDays } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { getVisibleRange } from '../../lib/calendar/range'
import { eventDisplayTitle } from '../../lib/calendar/labels'
import type { CalendarItem, MonthGridProps } from './types'

const MAX_PILLS_PER_DAY = 2
const SOFT_TINT_ALPHA = '1A'

function dayKeyOf(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function fullDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function isWeekend(date: Date): boolean {
  const weekday = date.getDay()
  return weekday === 0 || weekday === 6
}

function buildWeeks(anchor: Date): Date[][] {
  const range = getVisibleRange('month', anchor, 0)
  const weeks: Date[][] = []
  let cursor = range.from
  while (cursor.getTime() <= range.to.getTime()) {
    const week: Date[] = []
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      week.push(cursor)
      cursor = addDays(cursor, 1)
    }
    weeks.push(week)
  }
  return weeks
}

function groupItemsByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const sorted = [...items].sort((first, second) => first.start.getTime() - second.start.getTime())
  const byDay = new Map<string, CalendarItem[]>()
  for (const item of sorted) {
    const key = dayKeyOf(item.start)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(item)
    else byDay.set(key, [item])
  }
  return byDay
}

function MonthPill({ item, onItemClick }: { item: CalendarItem; onItemClick: (item: CalendarItem) => void }) {
  const t = useT()
  const canceled = item.status === 'canceled'
  const title = eventDisplayTitle(item.title, t('customers.calendar.grid.untitled', 'Untitled'))
  const timeLabel = item.allDay ? '' : ` · ${formatTime(item.start)} – ${formatTime(item.end)}`
  const tintStyle = item.color
    ? { backgroundColor: `${item.color}${SOFT_TINT_ALPHA}`, color: item.color }
    : undefined
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={`${title}${timeLabel}`}
      onClick={(event) => {
        event.stopPropagation()
        onItemClick(item)
      }}
      className={cn(
        'h-4 w-full min-w-0 justify-center gap-0 rounded-full p-0 pr-2',
        !item.color && 'bg-muted text-muted-foreground',
        canceled && 'opacity-60',
      )}
      style={tintStyle}
    >
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
        <span
          className={cn('size-1.5 rounded-full', !item.color && 'bg-muted-foreground')}
          style={item.color ? { backgroundColor: item.color } : undefined}
        />
      </span>
      <span
        className={cn(
          'min-w-0 truncate text-overline font-medium uppercase tracking-wide',
          canceled && 'line-through',
        )}
      >
        {title}
      </span>
    </Button>
  )
}

function MonthDayCell({
  day,
  anchor,
  items,
  onItemClick,
  onDayOpen,
}: {
  day: Date
  anchor: Date
  items: CalendarItem[]
  onItemClick: (item: CalendarItem) => void
  onDayOpen: (date: Date) => void
}) {
  const t = useT()
  const inMonth = isSameMonth(day, anchor)
  const today = isToday(day)
  const visibleItems = items.slice(0, MAX_PILLS_PER_DAY)
  const hiddenCount = items.length - visibleItems.length
  const dayLabel = fullDateLabel(day)
  return (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-1 flex-col items-start gap-1 overflow-hidden border-r border-border p-2 text-left last:border-r-0',
        isWeekend(day) ? 'bg-muted/40' : 'bg-background',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        aria-label={dayLabel}
        onClick={() => onDayOpen(day)}
        className="absolute inset-0 z-0 h-full w-full rounded-none p-0 hover:bg-muted/50"
      >
        <span className="sr-only">{dayLabel}</span>
      </Button>
      {today ? (
        <span className="pointer-events-none relative z-10 flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
          {day.getDate()}
        </span>
      ) : (
        <span className={cn('pointer-events-none relative z-10 text-xs font-medium', inMonth ? 'text-foreground' : 'text-muted-foreground')}>
          {day.getDate()}
        </span>
      )}
      <span className="relative z-20 hidden w-full flex-col gap-1 sm:flex">
        {visibleItems.map((item) => (
          <MonthPill key={item.id} item={item} onItemClick={onItemClick} />
        ))}
        {hiddenCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto self-start p-0 text-overline font-medium text-muted-foreground hover:bg-transparent hover:underline"
            onClick={(event) => {
              event.stopPropagation()
              onDayOpen(day)
            }}
          >
            {t('customers.calendar.grid.more', '+{count} more', { count: hiddenCount })}
          </Button>
        ) : null}
      </span>
      {items.length > 0 ? (
        <span aria-hidden="true" className="pointer-events-none relative z-10 flex w-full flex-wrap items-center gap-0.5 sm:hidden">
          {items.slice(0, 4).map((item) => (
            <span
              key={item.id}
              className={cn('size-1.5 rounded-full', !item.color && 'bg-muted-foreground')}
              style={item.color ? { backgroundColor: item.color } : undefined}
            />
          ))}
          {items.length > 4 ? (
            <span className="text-overline font-medium leading-none text-muted-foreground">
              +{items.length - 4}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

export function MonthGrid({ anchor, items, onItemClick, onDayOpen }: MonthGridProps) {
  const t = useT()
  const weeks = React.useMemo(() => buildWeeks(anchor), [anchor])
  const itemsByDay = React.useMemo(() => groupItemsByDay(items), [items])
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-background">
      <div className="flex h-9 w-full shrink-0 border-b border-border">
        {weeks[0]?.map((day) => {
          const label = day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()
          return (
            <div
              key={dayKeyOf(day)}
              className="flex min-w-0 flex-1 items-center justify-center border-r border-border last:border-r-0 sm:justify-start sm:pl-2.5"
            >
              <span className="truncate text-overline font-medium uppercase tracking-widest text-muted-foreground">
                <span className="sm:hidden">{label.charAt(0)}</span>
                <span className="hidden sm:inline">{label}</span>
              </span>
            </div>
          )
        })}
      </div>
      {weeks.map((week) => (
        <div
          key={dayKeyOf(week[0])}
          className="flex w-full flex-1 border-b border-border last:border-b-0 min-h-14 sm:min-h-[86px]"
        >
          {week.map((day) => (
            <MonthDayCell
              key={dayKeyOf(day)}
              day={day}
              anchor={anchor}
              items={itemsByDay.get(dayKeyOf(day)) ?? []}
              onItemClick={onItemClick}
              onDayOpen={onDayOpen}
            />
          ))}
        </div>
      ))}
      {items.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />}
            title={t('customers.calendar.empty.month', 'Nothing scheduled this month')}
            className="bg-background/90"
          />
        </div>
      ) : null}
    </div>
  )
}
