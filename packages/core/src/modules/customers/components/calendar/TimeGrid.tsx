"use client"

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays } from 'date-fns/addDays'
import { isSameDay } from 'date-fns/isSameDay'
import { startOfDay } from 'date-fns/startOfDay'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'
import {
  collapseDenseClusters,
  packOverlaps,
  packedColumnGeometry,
  resolveMaxPackedColumns,
} from '../../lib/calendar/layout'
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
import { OverflowBlock } from './OverflowBlock'
import type { CalendarItem, TimeGridProps } from './types'

const HOUR_HEIGHT_PX = 120
const HOURS_PER_DAY = 24
const GRID_BODY_MAX_HEIGHT_PX = 654
const INITIAL_SCROLL_HOUR = 8
const BLOCK_VERTICAL_GAP_PX = 1
const MIN_BLOCK_HEIGHT_PX = 32
const BLOCK_INSET_PX = 8
const SLOT_MINUTES = 30
const LAST_SLOT_START_MINUTES = HOURS_PER_DAY * 60 - SLOT_MINUTES
const COMPACT_SLOT_MAX_WIDTH_PX = 110

const NON_WORKING_HATCH_BACKGROUND =
  'repeating-linear-gradient(45deg, transparent 0px, transparent 8px, var(--border) 8px, var(--border) 9px)'

type PositionedBlock = {
  item: CalendarItem
  top: number
  height: number
  insetInlineStart: string
  width: string
  compact: boolean
}

type PositionedOverflow = {
  key: string
  items: CalendarItem[]
  start: Date
  end: Date
  top: number
  height: number
  insetInlineStart: string
  width: string
}

type DayColumnData = {
  dayStart: Date
  allDayItems: CalendarItem[]
  blocks: PositionedBlock[]
  overflows: PositionedOverflow[]
}

type DragState = { dayMs: number; startMin: number; endMin: number; pressSlotStartMin: number; moved: boolean }

type HoverSlot = { dayMs: number; startMin: number }

function slotStartFor(minute: number): number {
  return Math.min(LAST_SLOT_START_MINUTES, Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES)
}

function verticalGeometry(dayStartMs: number, startMs: number, endMs: number): { top: number; height: number } {
  const startMinutes = (startMs - dayStartMs) / 60000
  const durationMinutes = (endMs - startMs) / 60000
  const rawTop = (startMinutes / 60) * HOUR_HEIGHT_PX
  const rawHeight = (durationMinutes / 60) * HOUR_HEIGHT_PX
  return {
    top: rawTop + BLOCK_VERTICAL_GAP_PX,
    height: Math.max(MIN_BLOCK_HEIGHT_PX, rawHeight - BLOCK_VERTICAL_GAP_PX * 2),
  }
}

function buildDayColumn(
  dayStart: Date,
  items: CalendarItem[],
  maxPackedColumns: number,
  usableWidthPx: number | null,
): DayColumnData {
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

  const { visible, overflow } = collapseDenseClusters(packOverlaps(clones), maxPackedColumns)

  const blocks: PositionedBlock[] = visible.map(({ item: clone, column, columns }) => ({
    item: originalByClone.get(clone) ?? clone,
    ...verticalGeometry(dayStartMs, clone.start.getTime(), clone.end.getTime()),
    ...packedColumnGeometry(column, columns),
    compact: columns > 1 && usableWidthPx != null && usableWidthPx / columns < COMPACT_SLOT_MAX_WIDTH_PX,
  }))

  const overflows: PositionedOverflow[] = overflow.map((entry) => ({
    key: `${dayStartMs}-${entry.cluster}`,
    items: entry.items.map((clone) => originalByClone.get(clone) ?? clone),
    start: entry.start,
    end: entry.end,
    ...verticalGeometry(dayStartMs, entry.start.getTime(), entry.end.getTime()),
    ...packedColumnGeometry(entry.column, entry.columns),
  }))

  return { dayStart, allDayItems, blocks, overflows }
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
        selected && 'shadow-md ring-2 ring-primary/40',
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
  typeIcons,
  onItemClick,
  onCancelItem,
  onJoin,
  onNavigate,
  onCreateRange,
}: TimeGridProps) {
  const t = useT()
  const locale = useLocale()
  const isMobile = useIsMobile()
  const peekSide = isMobile ? 'bottom' : 'right'
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const nowMs = Date.now()
  const today = startOfDay(new Date())
  const todayMs = today.getTime()
  const anchorMs = anchor.getTime()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [openOverflowKey, setOpenOverflowKey] = React.useState<string | null>(null)
  const [drag, setDrag] = React.useState<DragState | null>(null)
  const [hoverSlot, setHoverSlot] = React.useState<HoverSlot | null>(null)
  const floatingScrollOriginRef = React.useRef<{ top: number; left: number } | null>(null)
  const measureRef = React.useRef<HTMLDivElement | null>(null)
  const [columnWidthPx, setColumnWidthPx] = React.useState<number | null>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const updateDrag = (next: DragState | null) => {
    dragRef.current = next
    setDrag(next)
  }

  const dayStarts = React.useMemo(() => {
    const rangeStart = getVisibleRange(days === 7 ? 'week' : 'day', new Date(anchorMs), 0).from
    const all = Array.from({ length: days }, (_, index) => addDays(rangeStart, index))
    return days === 7 ? applyWeekendVisibility(all, showWeekends, new Date(todayMs)) : all
  }, [days, anchorMs, showWeekends, todayMs])

  React.useEffect(() => {
    const node = scrollRef.current
    const floatingOpen = selectedId !== null || openOverflowKey !== null
    floatingScrollOriginRef.current = node && floatingOpen ? { top: node.scrollTop, left: node.scrollLeft } : null
  }, [selectedId, openOverflowKey])

  React.useEffect(() => {
    const node = measureRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const measure = () => setColumnWidthPx(node.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [dayStarts])

  const usableWidthPx = columnWidthPx == null ? null : columnWidthPx - BLOCK_INSET_PX * 2
  const maxPackedColumns = React.useMemo(() => resolveMaxPackedColumns(usableWidthPx), [usableWidthPx])

  const dayColumns = React.useMemo(
    () => dayStarts.map((dayStart) => buildDayColumn(dayStart, items, maxPackedColumns, usableWidthPx)),
    [dayStarts, items, maxPackedColumns, usableWidthPx],
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
    if (days === 1) return `${dayNumber} ${formatters.weekdayLong.format(dayStart).toUpperCase()}`
    return `${dayNumber} ${formatters.weekdayShort.format(dayStart).toUpperCase()}`
  }

  const canCreateRange = Boolean(onCreateRange)

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, dayStart: Date) => {
    if (!canCreateRange || event.button !== 0) return
    // A click beside an open peek or overflow list only dismisses it; it must
    // not double as "create an event in this slot".
    if (selectedId !== null || openOverflowKey !== null) {
      closeFloating()
      return
    }
    const layer = event.currentTarget
    const rect = layer.getBoundingClientRect()
    const offsetY = event.clientY - rect.top
    const minute = offsetYToMinutes(offsetY, HOUR_HEIGHT_PX)
    try {
      layer.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort; ignore environments that reject it.
    }
    setSelectedId(null)
    updateDrag({
      dayMs: dayStart.getTime(),
      startMin: minute,
      endMin: minute,
      pressSlotStartMin: slotStartFor(offsetYToMinutes(offsetY, HOUR_HEIGHT_PX, 1)),
      moved: false,
    })
  }

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>, dayStart: Date) => {
    const previous = dragRef.current
    const rect = event.currentTarget.getBoundingClientRect()
    if (!previous) {
      const slotStart = slotStartFor(offsetYToMinutes(event.clientY - rect.top, HOUR_HEIGHT_PX, 1))
      setHoverSlot((current) =>
        current && current.dayMs === dayStart.getTime() && current.startMin === slotStart
          ? current
          : { dayMs: dayStart.getTime(), startMin: slotStart },
      )
      return
    }
    const minute = offsetYToMinutes(event.clientY - rect.top, HOUR_HEIGHT_PX)
    if (minute === previous.endMin) return
    updateDrag({
      ...previous,
      endMin: minute,
      moved: previous.moved || Math.abs(minute - previous.startMin) >= DRAG_SNAP_MINUTES,
    })
  }

  // A peek or overflow list anchored to a block that is scrolling away (possibly
  // under the sticky day header) would float over unrelated chrome, so close it.
  const closeFloating = () => {
    setSelectedId((current) => (current === null ? current : null))
    setOpenOverflowKey((current) => (current === null ? current : null))
  }

  // Scroll events are delivered on the next frame, so one can arrive after the click
  // that followed the scroll. Only movement since the peek opened may close it.
  const closeFloatingIfScrolled = () => {
    const node = scrollRef.current
    const origin = floatingScrollOriginRef.current
    if (!node || !origin) return
    if (node.scrollTop === origin.top && node.scrollLeft === origin.left) return
    closeFloating()
  }

  const endDrag = (dayStart: Date) => {
    const previous = dragRef.current
    updateDrag(null)
    if (!previous || !onCreateRange) return
    if (previous.moved) {
      const range = buildDragRange(dayStart, previous.startMin, previous.endMin)
      onCreateRange(range.start, range.end)
      return
    }
    // A plain click creates the half-hour slot under the pointer, so the user
    // never has to discover drag-to-create first.
    const range = buildDragRange(dayStart, previous.pressSlotStartMin, previous.pressSlotStartMin + SLOT_MINUTES)
    onCreateRange(range.start, range.end)
  }

  return (
    <div className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div
        ref={scrollRef}
        className="overflow-auto overscroll-contain"
        style={{ maxHeight: GRID_BODY_MAX_HEIGHT_PX }}
        onScroll={closeFloatingIfScrolled}
      >
        <div className="sticky top-0 z-40 min-w-full bg-card max-md:w-max">
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
                      side={peekSide}
                      item={item}
                      open={selectedId === item.id}
                      joinUrl={resolveJoinUrl(item.location)}
                      aiSummaries={aiSummaries}
                      canManage={canManage}
                      typeIcon={typeIcons?.[item.interactionType]}
                      onOpenChange={(open) => setSelectedId(open ? item.id : null)}
                      onJoin={onJoin}
                      onEdit={onItemClick}
                      onCancel={onCancelItem}
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
          {dayColumns.map(({ dayStart, blocks, overflows }, columnIndex) => {
            const nonWorking = isWeekendDay(dayStart)
            const conflictCount = showConflicts
              ? blocks.filter((block) => conflictIds.has(block.item.id)).length +
                overflows.reduce(
                  (sum, overflow) => sum + overflow.items.filter((item) => conflictIds.has(item.id)).length,
                  0,
                )
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
                ref={columnIndex === 0 ? measureRef : undefined}
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
                {canCreateRange && !dragActive && hoverSlot && hoverSlot.dayMs === dayStart.getTime() ? (
                  <div
                    aria-hidden
                    data-calendar-hover-slot={hoverSlot.startMin}
                    className="pointer-events-none absolute inset-x-0 rounded-sm bg-muted/50"
                    style={{ top: (hoverSlot.startMin / 60) * HOUR_HEIGHT_PX, height: HOUR_HEIGHT_PX / 2 }}
                  />
                ) : null}
                {canCreateRange ? (
                  <div
                    className="absolute inset-0 cursor-cell"
                    onPointerDown={(event) => beginDrag(event, dayStart)}
                    onPointerMove={(event) => moveDrag(event, dayStart)}
                    onPointerUp={() => endDrag(dayStart)}
                    onPointerCancel={() => updateDrag(null)}
                    onPointerLeave={() => setHoverSlot(null)}
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
                      insetInlineStart: BLOCK_INSET_PX,
                      insetInlineEnd: BLOCK_INSET_PX,
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
                <div
                  className="pointer-events-none absolute inset-y-0"
                  style={{ insetInlineStart: BLOCK_INSET_PX, insetInlineEnd: BLOCK_INSET_PX }}
                >
                  {blocks.map((block) => (
                    <EventPeekPopover
                      key={`${block.item.id}-${block.top}`}
                      side={peekSide}
                      item={block.item}
                      open={selectedId === block.item.id}
                      joinUrl={resolveJoinUrl(block.item.location)}
                      aiSummaries={aiSummaries}
                      canManage={canManage}
                      typeIcon={typeIcons?.[block.item.interactionType]}
                      onOpenChange={(open) => setSelectedId(open ? block.item.id : null)}
                      onJoin={onJoin}
                      onEdit={onItemClick}
                      onCancel={onCancelItem}
                    >
                      <EventBlock
                        item={block.item}
                        top={block.top}
                        height={block.height}
                        insetInlineStart={block.insetInlineStart}
                        width={block.width}
                        compact={block.compact}
                        conflicted={showConflicts && conflictIds.has(block.item.id)}
                        highlighted={highlightItemId === block.item.id}
                        selected={selectedId === block.item.id}
                        nowMs={nowMs}
                      />
                    </EventPeekPopover>
                  ))}
                  {overflows.map((overflow) => (
                    <OverflowBlock
                      key={overflow.key}
                      items={overflow.items}
                      start={overflow.start}
                      end={overflow.end}
                      top={overflow.top}
                      height={overflow.height}
                      insetInlineStart={overflow.insetInlineStart}
                      width={overflow.width}
                      open={openOverflowKey === overflow.key}
                      conflictIds={conflictIds}
                      showConflicts={showConflicts}
                      highlightItemId={highlightItemId}
                      typeIcons={typeIcons}
                      canManage={canManage}
                      aiSummaries={aiSummaries}
                      nowMs={nowMs}
                      resolveJoinUrl={resolveJoinUrl}
                      onOpenChange={(open) => setOpenOverflowKey(open ? overflow.key : null)}
                      onJoin={onJoin}
                      onEdit={onItemClick}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
