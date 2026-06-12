"use client"

import * as React from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays } from 'date-fns/addDays'
import { isSameDay } from 'date-fns/isSameDay'
import { startOfDay } from 'date-fns/startOfDay'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { packOverlaps } from '../../lib/calendar/layout'
import { getVisibleRange } from '../../lib/calendar/range'
import { EventBlock, resolveEventTone } from './EventBlock'
import type { CalendarItem, TimeGridProps } from './types'

const HOUR_HEIGHT_PX = 120
const HOURS_PER_DAY = 24
const GRID_BODY_MAX_HEIGHT_PX = 654
const INITIAL_SCROLL_HOUR = 8
const BLOCK_VERTICAL_GAP_PX = 1
const MIN_BLOCK_HEIGHT_PX = 32
const PACKED_COLUMN_GAP_PX = 2

const NON_WORKING_HATCH_BACKGROUND =
  'repeating-linear-gradient(45deg, transparent 0px, transparent 8px, var(--border) 8px, var(--border) 9px)'

type PositionedBlock = {
  item: CalendarItem
  top: number
  height: number
  insetInlineStart: string
  width: string
}

type DayColumnData = {
  dayStart: Date
  allDayItems: CalendarItem[]
  blocks: PositionedBlock[]
}

function isNonWorkingDay(date: Date): boolean {
  const weekday = date.getDay()
  return weekday === 0 || weekday === 6
}

function buildDayColumn(dayStart: Date, items: CalendarItem[]): DayColumnData {
  const dayEnd = addDays(dayStart, 1)
  const dayStartMs = dayStart.getTime()
  const dayEndMs = dayEnd.getTime()
  const allDayItems: CalendarItem[] = []
  const segments: Array<{ original: CalendarItem; start: Date; end: Date }> = []

  for (const item of items) {
    const startMs = item.start.getTime()
    const endMs = item.end.getTime()
    if (startMs >= dayEndMs || endMs <= dayStartMs) continue
    if (item.allDay) {
      allDayItems.push(item)
      continue
    }
    segments.push({
      original: item,
      start: startMs < dayStartMs ? dayStart : item.start,
      end: endMs > dayEndMs ? dayEnd : item.end,
    })
  }

  allDayItems.sort((first, second) => first.start.getTime() - second.start.getTime())

  const clones = segments.map((segment) => ({ ...segment.original, start: segment.start, end: segment.end }))
  const originalByClone = new Map<CalendarItem, CalendarItem>()
  clones.forEach((clone, index) => originalByClone.set(clone, segments[index].original))

  const blocks: PositionedBlock[] = packOverlaps(clones).map(({ item: clone, column, columns }) => {
    const startMinutes = (clone.start.getTime() - dayStartMs) / 60000
    const durationMinutes = (clone.end.getTime() - clone.start.getTime()) / 60000
    const rawTop = (startMinutes / 60) * HOUR_HEIGHT_PX
    const rawHeight = (durationMinutes / 60) * HOUR_HEIGHT_PX
    const widthPct = 100 / columns
    return {
      item: originalByClone.get(clone) ?? clone,
      top: rawTop + BLOCK_VERTICAL_GAP_PX,
      height: Math.max(MIN_BLOCK_HEIGHT_PX, rawHeight - BLOCK_VERTICAL_GAP_PX * 2),
      insetInlineStart: `calc(${column * widthPct}% + ${column * PACKED_COLUMN_GAP_PX}px)`,
      width: `calc(${widthPct}% - ${((columns - 1) * PACKED_COLUMN_GAP_PX) / columns}px)`,
    }
  })

  return { dayStart, allDayItems, blocks }
}

type AllDayChipProps = {
  item: CalendarItem
  conflicted: boolean
  highlighted: boolean
  nowMs: number
  onClick(item: CalendarItem): void
}

function AllDayChip({ item, conflicted, highlighted, nowMs, onClick }: AllDayChipProps) {
  const t = useT()
  const tone = resolveEventTone(item, nowMs)
  const title = item.title || t('customers.calendar.grid.untitled', 'Untitled')
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onClick(item)}
      aria-label={`${title}, ${t('customers.calendar.grid.allDay', 'All day')}`}
      className={cn(
        'h-auto w-full min-w-0 justify-start rounded-sm px-2 py-0.5 text-start hover:bg-muted/70',
        tone.surfaceClassName,
        conflicted && 'ring-1 ring-status-warning-icon',
        highlighted && 'motion-safe:animate-pulse',
        'focus-visible:ring-2 focus-visible:ring-ring',
      )}
      style={tone.style}
    >
      <span className={cn('truncate text-xs font-medium', tone.titleClassName)}>{title}</span>
    </Button>
  )
}

export function TimeGrid({ days, anchor, items, conflictIds, highlightItemId, onItemClick, onNavigate }: TimeGridProps) {
  const t = useT()
  const locale = useLocale()
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const nowMs = Date.now()
  const today = startOfDay(new Date())
  const anchorMs = anchor.getTime()

  const dayStarts = React.useMemo(() => {
    const rangeStart = getVisibleRange(days === 7 ? 'week' : 'day', new Date(anchorMs), 0).from
    return Array.from({ length: days }, (_, index) => addDays(rangeStart, index))
  }, [days, anchorMs])

  const dayColumns = React.useMemo(
    () => dayStarts.map((dayStart) => buildDayColumn(dayStart, items)),
    [dayStarts, items],
  )

  const hasAllDayLane = dayColumns.some((column) => column.allDayItems.length > 0)

  const formatters = React.useMemo(
    () => ({
      dayNumber: new Intl.DateTimeFormat(locale, { day: '2-digit' }),
      weekdayShort: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      weekdayLong: new Intl.DateTimeFormat(locale, { weekday: 'long' }),
    }),
    [locale],
  )

  const hourLabels = React.useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { hour: 'numeric' })
    return Array.from({ length: HOURS_PER_DAY }, (_, hour) => formatter.format(new Date(2024, 0, 1, hour)))
  }, [locale])

  React.useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = INITIAL_SCROLL_HOUR * HOUR_HEIGHT_PX
  }, [])

  React.useEffect(() => {
    if (!highlightItemId) return
    const node = scrollRef.current
    if (!node) return
    const target = items.find((item) => item.id === highlightItemId && !item.allDay)
    if (!target) return
    const minutes = (target.start.getTime() - startOfDay(target.start).getTime()) / 60000
    const top = (minutes / 60) * HOUR_HEIGHT_PX
    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollTo({ top: Math.max(0, top - HOUR_HEIGHT_PX), behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [highlightItemId, items])

  const nonWorkingLabel = t('customers.calendar.grid.nonWorking', 'Non-working day')
  const previousLabel =
    days === 7
      ? t('customers.calendar.previousWeek', 'Previous week')
      : t('customers.calendar.grid.previousDay', 'Previous day')
  const nextLabel =
    days === 7 ? t('customers.calendar.nextWeek', 'Next week') : t('customers.calendar.grid.nextDay', 'Next day')

  const headerLabelFor = (dayStart: Date): string => {
    const dayNumber = formatters.dayNumber.format(dayStart)
    if (days === 1) return `${formatters.weekdayLong.format(dayStart).toUpperCase()} · ${dayNumber}`
    return `${dayNumber} ${formatters.weekdayShort.format(dayStart).toUpperCase()}`
  }

  return (
    <div className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div
        ref={scrollRef}
        className="overflow-auto overscroll-contain"
        style={{ maxHeight: GRID_BODY_MAX_HEIGHT_PX }}
      >
        <div className="sticky top-0 z-30 min-w-full bg-card max-md:w-max">
          <div className="flex border-b border-border">
            <div className="sticky start-0 z-10 flex w-14 shrink-0 bg-card md:w-26">
              <span className="flex flex-1 items-center justify-center border-e border-border">
                <IconButton type="button" variant="ghost" size="xs" aria-label={previousLabel} onClick={() => onNavigate(-days)}>
                  <ChevronLeft aria-hidden />
                </IconButton>
              </span>
              <span className="flex flex-1 items-center justify-center border-e border-border">
                <IconButton type="button" variant="ghost" size="xs" aria-label={nextLabel} onClick={() => onNavigate(days)}>
                  <ChevronRight aria-hidden />
                </IconButton>
              </span>
            </div>
            {dayColumns.map(({ dayStart }) => {
              const isToday = isSameDay(dayStart, today)
              return (
                <div
                  key={dayStart.getTime()}
                  className={cn(
                    'flex min-w-0 flex-1 items-center justify-center border-e border-border bg-muted px-1 py-2 last:border-e-0',
                    days === 7 && 'min-w-[120px] max-md:max-w-[120px] md:min-w-0',
                  )}
                >
                  <span
                    className={cn(
                      'truncate text-xs uppercase tracking-wide',
                      isToday ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                    )}
                  >
                    {headerLabelFor(dayStart)}
                  </span>
                </div>
              )
            })}
          </div>
          {hasAllDayLane ? (
            <div className="flex border-b border-border">
              <div className="sticky start-0 z-10 flex w-14 shrink-0 items-center justify-center border-e border-border bg-card py-1 md:w-26">
                <span className="truncate text-overline uppercase tracking-wide text-muted-foreground">
                  {t('customers.calendar.grid.allDay', 'All day')}
                </span>
              </div>
              {dayColumns.map(({ dayStart, allDayItems }) => (
                <div
                  key={dayStart.getTime()}
                  className={cn(
                    'min-w-0 flex-1 space-y-1 border-e border-border p-1 last:border-e-0',
                    days === 7 && 'min-w-[120px] max-md:max-w-[120px] md:min-w-0',
                  )}
                >
                  {allDayItems.map((item) => (
                    <AllDayChip
                      key={item.id}
                      item={item}
                      conflicted={conflictIds.has(item.id)}
                      highlighted={highlightItemId === item.id}
                      nowMs={nowMs}
                      onClick={onItemClick}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex min-w-full max-md:w-max" style={{ height: HOURS_PER_DAY * HOUR_HEIGHT_PX }}>
          <div className="sticky start-0 z-10 w-14 shrink-0 border-e border-border bg-card md:w-26">
            <div className="relative h-full">
              {hourLabels.map((label, hour) =>
                hour === 0 ? null : (
                  <span
                    key={hour}
                    className="absolute w-full -translate-y-1/2 px-1 text-center text-xs font-medium text-muted-foreground md:px-3 md:text-sm"
                    style={{ top: hour * HOUR_HEIGHT_PX }}
                  >
                    {label}
                  </span>
                ),
              )}
            </div>
          </div>
          {dayColumns.map(({ dayStart, blocks }) => {
            const nonWorking = isNonWorkingDay(dayStart)
            return (
              <div
                key={dayStart.getTime()}
                className={cn(
                  'relative min-w-0 flex-1 border-e border-border last:border-e-0',
                  days === 7 && 'min-w-[120px] max-md:max-w-[120px] md:min-w-0',
                )}
                title={nonWorking ? nonWorkingLabel : undefined}
              >
                {nonWorking ? <span className="sr-only">{nonWorkingLabel}</span> : null}
                <div aria-hidden className="absolute inset-0">
                  {Array.from({ length: HOURS_PER_DAY }, (_, hour) => (
                    <div key={hour} className="relative h-30 border-b border-border">
                      <span className="absolute inset-x-0 top-1/2 h-px bg-border/50" />
                    </div>
                  ))}
                </div>
                {nonWorking ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundImage: NON_WORKING_HATCH_BACKGROUND }}
                  />
                ) : null}
                <div className="absolute inset-y-0" style={{ insetInlineStart: 8, insetInlineEnd: 8 }}>
                  {blocks.map((block) => (
                    <EventBlock
                      key={`${block.item.id}-${block.top}`}
                      item={block.item}
                      top={block.top}
                      height={block.height}
                      insetInlineStart={block.insetInlineStart}
                      width={block.width}
                      conflicted={conflictIds.has(block.item.id)}
                      highlighted={highlightItemId === block.item.id}
                      nowMs={nowMs}
                      onClick={onItemClick}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-6">
          <EmptyState
            className="pointer-events-auto bg-card/95 shadow-sm"
            icon={<CalendarDays className="h-6 w-6" aria-hidden />}
            title={
              days === 7
                ? t('customers.calendar.empty.week', 'Nothing scheduled this week')
                : t('customers.calendar.empty.day', 'Nothing scheduled this day')
            }
          />
        </div>
      ) : null}
    </div>
  )
}
