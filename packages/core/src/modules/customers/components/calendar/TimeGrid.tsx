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
import {
  applyWeekendVisibility,
  buildDragRange,
  DRAG_SNAP_MINUTES,
  isWeekendDay,
  offsetYToMinutes,
} from '../../lib/calendar/grid'
import { EventBlock, formatTimeRange, resolveEventTone } from './EventBlock'
import { EventPeekPopover } from './EventPeekPopover'
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

type DragState = { dayMs: number; startMin: number; endMin: number; moved: boolean }

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

type ConflictBadgeProps = { count: number }

function ConflictBadge({ count }: ConflictBadgeProps) {
  const t = useT()
  const label =
    count === 1
      ? t('customers.calendar.grid.conflictCount', '1 conflict')
      : t('customers.calendar.grid.conflictsCount', '{count} conflicts', { count })
  return (
    <span className="pointer-events-none absolute left-2 top-1 z-40 inline-flex items-center gap-1 rounded-full bg-status-error-bg px-2 py-0.5 text-overline font-medium uppercase tracking-wide text-status-error-text">
      <span aria-hidden className="size-1.5 rounded-full bg-status-error-icon" />
      {label}
    </span>
  )
}

type AllDayChipProps = {
  item: CalendarItem
  conflicted: boolean
  highlighted: boolean
  selected: boolean
  nowMs: number
} & Omit<React.ComponentProps<typeof Button>, 'style' | 'children'>

const AllDayChip = React.forwardRef<HTMLButtonElement, AllDayChipProps>(function AllDayChip(
  { item, conflicted, highlighted, selected, nowMs, className, ...buttonProps },
  ref,
) {
  const t = useT()
  const tone = resolveEventTone(item, nowMs)
  const title = item.title || t('customers.calendar.grid.untitled', 'Untitled')
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      aria-label={`${title}, ${t('customers.calendar.grid.allDay', 'All day')}`}
      className={cn(
        'h-auto w-full min-w-0 justify-start rounded-sm px-2 py-0.5 text-start hover:bg-muted/70',
        tone.surfaceClassName,
        conflicted && 'ring-1 ring-status-warning-icon',
        selected && 'shadow-md ring-2 ring-foreground',
        highlighted && 'motion-safe:animate-pulse',
        'focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      style={tone.style}
      {...buttonProps}
    >
      <span className={cn('truncate text-xs font-medium', tone.titleClassName)}>{title}</span>
    </Button>
  )
})

AllDayChip.displayName = 'AllDayChip'

export function TimeGrid({
  days,
  anchor,
  items,
  conflictIds,
  showWeekends,
  showConflicts,
  aiSummaries,
  canManage = true,
  highlightItemId,
  onItemClick,
  onJoin,
  onNavigate,
  onCreate,
  onCreateRange,
}: TimeGridProps) {
  const t = useT()
  const locale = useLocale()
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const nowMs = Date.now()
  const today = startOfDay(new Date())
  const todayMs = today.getTime()
  const anchorMs = anchor.getTime()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [drag, setDrag] = React.useState<DragState | null>(null)

  const dayStarts = React.useMemo(() => {
    const rangeStart = getVisibleRange(days === 7 ? 'week' : 'day', new Date(anchorMs), 0).from
    const all = Array.from({ length: days }, (_, index) => addDays(rangeStart, index))
    return days === 7 ? applyWeekendVisibility(all, showWeekends, new Date(todayMs)) : all
  }, [days, anchorMs, showWeekends, todayMs])

  const dayColumns = React.useMemo(
    () => dayStarts.map((dayStart) => buildDayColumn(dayStart, items)),
    [dayStarts, items],
  )

  const resolveJoinUrl = React.useCallback((location: string | null): string | null => {
    const trimmed = location?.trim() ?? ''
    if (!trimmed) return null
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (/^www\./i.test(trimmed)) return `https://${trimmed}`
    return null
  }, [])

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

  const canCreateRange = Boolean(onCreateRange)

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, dayStart: Date) => {
    if (!canCreateRange || event.button !== 0) return
    const layer = event.currentTarget
    const rect = layer.getBoundingClientRect()
    const minute = offsetYToMinutes(event.clientY - rect.top, HOUR_HEIGHT_PX)
    try {
      layer.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort; ignore environments that reject it.
    }
    setSelectedId(null)
    setDrag({ dayMs: dayStart.getTime(), startMin: minute, endMin: minute, moved: false })
  }

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    // Read the layer rect synchronously: `event.currentTarget` is only valid during
    // event dispatch, but the setDrag updater below runs later during re-render.
    const rect = event.currentTarget.getBoundingClientRect()
    const minute = offsetYToMinutes(event.clientY - rect.top, HOUR_HEIGHT_PX)
    setDrag((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        endMin: minute,
        moved: previous.moved || Math.abs(minute - previous.startMin) >= DRAG_SNAP_MINUTES,
      }
    })
  }

  const endDrag = (dayStart: Date) => {
    setDrag((previous) => {
      if (previous && previous.moved && onCreateRange) {
        const range = buildDragRange(dayStart, previous.startMin, previous.endMin)
        onCreateRange(range.start, range.end)
      }
      return null
    })
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
                    <EventPeekPopover
                      key={item.id}
                      item={item}
                      open={selectedId === item.id}
                      joinUrl={resolveJoinUrl(item.location)}
                      aiSummaries={aiSummaries}
                      canManage={canManage}
                      onOpenChange={(open) => setSelectedId(open ? item.id : null)}
                      onJoin={onJoin}
                      onEdit={onItemClick}
                    >
                      <AllDayChip
                        item={item}
                        conflicted={showConflicts && conflictIds.has(item.id)}
                        highlighted={highlightItemId === item.id}
                        selected={selectedId === item.id}
                        nowMs={nowMs}
                      />
                    </EventPeekPopover>
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
            const nonWorking = isWeekendDay(dayStart)
            const conflictCount = showConflicts
              ? blocks.filter((block) => conflictIds.has(block.item.id)).length
              : 0
            const dragActive = drag && drag.moved && drag.dayMs === dayStart.getTime()
            const dragRange = dragActive ? buildDragRange(dayStart, drag.startMin, drag.endMin) : null
            const dragStartMinutes = dragRange
              ? (dragRange.start.getTime() - startOfDay(dragRange.start).getTime()) / 60000
              : 0
            const dragDurationMinutes = dragRange
              ? (dragRange.end.getTime() - dragRange.start.getTime()) / 60000
              : 0
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
                {canCreateRange ? (
                  <div
                    className="absolute inset-0 cursor-cell"
                    onPointerDown={(event) => beginDrag(event, dayStart)}
                    onPointerMove={moveDrag}
                    onPointerUp={() => endDrag(dayStart)}
                    onPointerCancel={() => setDrag(null)}
                    aria-hidden
                  />
                ) : null}
                {dragRange ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute z-30 flex flex-col gap-0.5 overflow-hidden rounded-md border-2 border-dashed border-foreground bg-accent-indigo/10 px-2 pt-1.5"
                    style={{
                      top: (dragStartMinutes / 60) * HOUR_HEIGHT_PX,
                      height: Math.max(MIN_BLOCK_HEIGHT_PX, (dragDurationMinutes / 60) * HOUR_HEIGHT_PX),
                      insetInlineStart: 8,
                      insetInlineEnd: 8,
                    }}
                  >
                    <span className="text-overline font-semibold text-foreground">
                      {t('customers.calendar.actions.newEvent', 'New event')}
                    </span>
                    <span className="text-overline text-muted-foreground">
                      {formatTimeRange(locale, dragRange.start, dragRange.end)}
                    </span>
                  </div>
                ) : null}
                {conflictCount > 0 ? <ConflictBadge count={conflictCount} /> : null}
                {/* Click-through container so empty space reaches the drag-to-create layer
                    below; each block re-enables pointer events for its own click/peek. */}
                <div className="pointer-events-none absolute inset-y-0" style={{ insetInlineStart: 8, insetInlineEnd: 8 }}>
                  {blocks.map((block) => (
                    <EventPeekPopover
                      key={`${block.item.id}-${block.top}`}
                      item={block.item}
                      open={selectedId === block.item.id}
                      joinUrl={resolveJoinUrl(block.item.location)}
                      aiSummaries={aiSummaries}
                      canManage={canManage}
                      onOpenChange={(open) => setSelectedId(open ? block.item.id : null)}
                      onJoin={onJoin}
                      onEdit={onItemClick}
                    >
                      <EventBlock
                        item={block.item}
                        top={block.top}
                        height={block.height}
                        insetInlineStart={block.insetInlineStart}
                        width={block.width}
                        conflicted={showConflicts && conflictIds.has(block.item.id)}
                        highlighted={highlightItemId === block.item.id}
                        selected={selectedId === block.item.id}
                        nowMs={nowMs}
                      />
                    </EventPeekPopover>
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
            description={t('customers.calendar.empty.description', 'Plan a meeting, event or task to fill your week.')}
            actions={
              onCreate ? (
                <Button type="button" size="sm" onClick={onCreate}>
                  {t('customers.calendar.actions.newEvent', 'New event')}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : null}
    </div>
  )
}
