'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { InteractionSummary } from './types'

interface ActivitiesDayStripProps {
  entityId: string
  selectedDate: Date
  onSelectDate: (date: Date) => void
  refreshKey?: number
}

const VISIBLE_DAYS = 5
const BUSYNESS_SLOTS = 10
const SLOT_START_HOUR = 7
const SLOT_END_HOUR = 22

const DAY_LABEL_KEYS: Array<[number, string, string]> = [
  [0, 'customers.calendar.day.sun', 'SUN'],
  [1, 'customers.calendar.day.mon', 'MON'],
  [2, 'customers.calendar.day.tue', 'TUE'],
  [3, 'customers.calendar.day.wed', 'WED'],
  [4, 'customers.calendar.day.thu', 'THU'],
  [5, 'customers.calendar.day.fri', 'FRI'],
  [6, 'customers.calendar.day.sat', 'SAT'],
]

const MONTH_KEYS: Array<[number, string, string]> = [
  [0, 'customers.calendar.month.january', 'January'],
  [1, 'customers.calendar.month.february', 'February'],
  [2, 'customers.calendar.month.march', 'March'],
  [3, 'customers.calendar.month.april', 'April'],
  [4, 'customers.calendar.month.may', 'May'],
  [5, 'customers.calendar.month.june', 'June'],
  [6, 'customers.calendar.month.july', 'July'],
  [7, 'customers.calendar.month.august', 'August'],
  [8, 'customers.calendar.month.september', 'September'],
  [9, 'customers.calendar.month.october', 'October'],
  [10, 'customers.calendar.month.november', 'November'],
  [11, 'customers.calendar.month.december', 'December'],
]

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

function addDays(date: Date, delta: number): Date {
  const next = new Date(date)
  next.setDate(date.getDate() + delta)
  return next
}

function buildVisibleDays(anchor: Date): Date[] {
  const start = startOfDay(anchor)
  return Array.from({ length: VISIBLE_DAYS }, (_, index) => addDays(start, index))
}

// Anchor the visible window so that the given focal date lands at the center slot
// (position 2 out of 5). Matches Figma 784:809 where the selected day is centered.
function anchorCenteredOn(focalDate: Date): Date {
  return startOfDay(addDays(focalDate, -Math.floor(VISIBLE_DAYS / 2)))
}

type SlotState = 'empty' | 'partial' | 'full' | 'conflict'

type DayBusyness = {
  totalMinutes: number
  eventCount: number
  slots: SlotState[]
}

function emptyBusyness(): DayBusyness {
  return {
    totalMinutes: 0,
    eventCount: 0,
    slots: Array<SlotState>(BUSYNESS_SLOTS).fill('empty'),
  }
}

function computeDayBusyness(events: InteractionSummary[], day: Date): DayBusyness {
  if (events.length === 0) return emptyBusyness()
  const dayStart = startOfDay(day).getTime()
  const slotMs = ((SLOT_END_HOUR - SLOT_START_HOUR) * 60 * 60 * 1000) / BUSYNESS_SLOTS
  const slotMinutes = slotMs / 60000
  const slotCounts: number[] = Array(BUSYNESS_SLOTS).fill(0)
  const slotMinutesUsed: number[] = Array(BUSYNESS_SLOTS).fill(0)
  let totalMinutes = 0
  let eventCount = 0

  for (const event of events) {
    const startIso = event.scheduledAt ?? event.occurredAt ?? event.createdAt
    if (!startIso) continue
    const start = new Date(startIso)
    if (Number.isNaN(start.getTime())) continue
    if (!isSameDay(start, day)) continue
    eventCount += 1
    const durationMinutes = typeof event.duration === 'number' && event.duration > 0 ? event.duration : 30
    totalMinutes += durationMinutes
    const eventStartMs = start.getTime()
    const eventEndMs = eventStartMs + durationMinutes * 60000
    const slotsStartMs = dayStart + SLOT_START_HOUR * 60 * 60 * 1000
    for (let slot = 0; slot < BUSYNESS_SLOTS; slot += 1) {
      const slotStart = slotsStartMs + slot * slotMs
      const slotEnd = slotStart + slotMs
      const overlapStart = Math.max(slotStart, eventStartMs)
      const overlapEnd = Math.min(slotEnd, eventEndMs)
      const overlapMinutes = Math.max(0, (overlapEnd - overlapStart) / 60000)
      if (overlapMinutes <= 0) continue
      slotCounts[slot] += 1
      slotMinutesUsed[slot] += overlapMinutes
    }
  }

  const slots: SlotState[] = slotCounts.map((count, index) => {
    if (count === 0) return 'empty'
    if (count > 1) return 'conflict'
    const used = slotMinutesUsed[index]
    if (used >= slotMinutes * 0.5) return 'full'
    return 'partial'
  })

  return { totalMinutes, eventCount, slots }
}

function formatBusyLabel(busy: DayBusyness, t: TranslateFn): string {
  if (busy.eventCount === 0) return ''
  // Match Figma 784:809 label format: "Xm" when under an hour, "Xh" otherwise.
  // Mixed "Xh Ym" overflows the 101px card and is not part of the visual spec.
  const durationLabel = busy.totalMinutes < 60
    ? t('customers.activities.calendar.minutesShort', '{minutes}m', { minutes: Math.max(Math.round(busy.totalMinutes), 1) })
    : t('customers.activities.calendar.hoursShort', '{hours}h', { hours: Math.floor(busy.totalMinutes / 60) })
  return t('customers.activities.calendar.eventsSummary', '{count} {countLabel} · {duration}', {
    count: busy.eventCount,
    countLabel: busy.eventCount === 1
      ? t('customers.activities.calendar.eventSingular', 'event')
      : t('customers.activities.calendar.eventPlural', 'events'),
    duration: durationLabel,
  })
}

function formatMonthLabel(date: Date, t: TranslateFn): string {
  const monthEntry = MONTH_KEYS.find(([index]) => index === date.getMonth())
  const monthName = monthEntry ? t(monthEntry[1], monthEntry[2]) : ''
  return t('customers.activities.calendar.monthYear', '{month} {year}', { month: monthName, year: date.getFullYear() })
}

function formatDayLabel(date: Date, t: TranslateFn): string {
  const entry = DAY_LABEL_KEYS.find(([index]) => index === date.getDay())
  return entry ? t(entry[1], entry[2]) : ''
}

export function ActivitiesDayStrip({ entityId, selectedDate, onSelectDate, refreshKey = 0 }: ActivitiesDayStripProps) {
  const t = useT()
  const [anchor, setAnchor] = React.useState<Date>(() => anchorCenteredOn(selectedDate))
  const [events, setEvents] = React.useState<InteractionSummary[]>([])

  React.useEffect(() => {
    setAnchor((current) => {
      const days = buildVisibleDays(current)
      const visible = days.some((day) => isSameDay(day, selectedDate))
      if (visible) return current
      return anchorCenteredOn(selectedDate)
    })
  }, [selectedDate])

  const visibleDays = React.useMemo(() => buildVisibleDays(anchor), [anchor])
  const headerLabel = React.useMemo(() => formatMonthLabel(visibleDays[0], t), [visibleDays, t])

  React.useEffect(() => {
    if (!entityId || visibleDays.length === 0) return
    const controller = new AbortController()
    const fromIso = startOfDay(visibleDays[0]).toISOString()
    const toIso = endOfDay(visibleDays[visibleDays.length - 1]).toISOString()
    const params = new URLSearchParams({
      entityId,
      from: fromIso,
      to: toIso,
      limit: '100',
      sortField: 'scheduledAt',
      sortDir: 'asc',
      excludeInteractionType: 'task',
    })
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<{ items?: InteractionSummary[] }>(
          `/api/customers/interactions?${params.toString()}`,
          { signal: controller.signal },
        )
        setEvents(Array.isArray(payload?.items) ? payload.items : [])
      } catch (err) {
        if ((err as { name?: string } | null)?.name !== 'AbortError') {
          console.warn('[ActivitiesDayStrip] failed to load interactions', err)
        }
        setEvents([])
      }
    })()
    return () => controller.abort()
  }, [entityId, visibleDays, refreshKey])

  const todayDate = React.useMemo(() => startOfDay(new Date()), [])

  const handlePrev = React.useCallback(() => {
    setAnchor((current) => addDays(current, -VISIBLE_DAYS))
  }, [])
  const handleNext = React.useCallback(() => {
    setAnchor((current) => addDays(current, VISIBLE_DAYS))
  }, [])
  const handleHeaderPrev = React.useCallback(() => {
    setAnchor((current) => {
      const next = new Date(current)
      next.setMonth(current.getMonth() - 1)
      return startOfDay(next)
    })
  }, [])
  const handleHeaderNext = React.useCallback(() => {
    setAnchor((current) => {
      const next = new Date(current)
      next.setMonth(current.getMonth() + 1)
      return startOfDay(next)
    })
  }, [])

  return (
    <div className="flex flex-col gap-2.5 rounded-md px-3.5 py-3 w-full">
      <div className="flex items-center justify-center gap-1.5 rounded-md bg-muted px-1.5 py-1.5">
        <button
          type="button"
          onClick={handleHeaderPrev}
          aria-label={t('customers.activities.calendar.prevMonth', 'Previous month')}
          className="flex size-6 items-center justify-center rounded-md border border-border bg-card shadow-xs hover:bg-accent/40"
        >
          <ChevronLeft className="size-4 text-foreground" />
        </button>
        <span className="flex-1 text-center text-sm font-medium leading-5 text-foreground">{headerLabel}</span>
        <button
          type="button"
          onClick={handleHeaderNext}
          aria-label={t('customers.activities.calendar.nextMonth', 'Next month')}
          className="flex size-6 items-center justify-center rounded-md border border-border bg-card shadow-xs hover:bg-accent/40"
        >
          <ChevronRight className="size-4 text-foreground" />
        </button>
      </div>
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={handlePrev}
          aria-label={t('customers.activities.calendar.prevWindow', 'Previous days')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-card shadow-xs hover:bg-accent/40"
        >
          <ChevronLeft className="size-4 text-foreground" />
        </button>
        <div className="flex flex-1 items-stretch justify-center gap-1">
          {visibleDays.map((day) => {
            const busy = computeDayBusyness(events, day)
            const isSelected = isSameDay(day, selectedDate)
            const isToday = isSameDay(day, todayDate)
            const weekend = isWeekend(day)
            const busyLabel = busy.eventCount > 0
              ? formatBusyLabel(busy, t)
              : weekend
                ? t('customers.activities.calendar.weekend', 'Weekend')
                : ''
            return (
              <DayCard
                key={day.toISOString()}
                day={day}
                isActive={isSelected}
                isToday={isToday}
                busyness={busy}
                label={busyLabel}
                dayName={formatDayLabel(day, t)}
                onSelect={() => onSelectDate(day)}
              />
            )
          })}
        </div>
        <button
          type="button"
          onClick={handleNext}
          aria-label={t('customers.activities.calendar.nextWindow', 'Next days')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-card shadow-xs hover:bg-accent/40"
        >
          <ChevronRight className="size-4 text-foreground" />
        </button>
      </div>
    </div>
  )
}

interface DayCardProps {
  day: Date
  isActive: boolean
  isToday: boolean
  busyness: DayBusyness
  label: string
  dayName: string
  onSelect: () => void
}

function DayCard({ day, isActive, isToday, busyness, label, dayName, onSelect }: DayCardProps) {
  const dayNumber = String(day.getDate()).padStart(2, '0')
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      aria-label={`${dayName} ${dayNumber}`}
      className={cn(
        'flex h-[104px] w-[101px] flex-col items-center gap-[6px] overflow-hidden rounded-[10px] border p-[12px] transition-colors',
        isActive
          ? 'border-transparent bg-foreground'
          : 'border-border bg-card hover:border-foreground/40',
      )}
    >
      <span className="text-[11px] font-medium leading-none tracking-[0.44px] text-muted-foreground">
        {dayName}
      </span>
      <div className="flex items-center gap-[5px]">
        <span
          className={cn(
            'text-2xl font-semibold leading-7',
            isActive ? 'text-background' : 'text-foreground',
          )}
        >
          {dayNumber}
        </span>
        {isToday ? (
          <span
            className="inline-block size-1.5 rounded-full bg-status-info-icon"
            aria-hidden
          />
        ) : null}
      </div>
      <div className="flex h-4 w-[82px] items-end gap-[1.5px]">
        {busyness.slots.map((state, index) => (
          <BusySlot key={index} state={state} active={isActive} />
        ))}
      </div>
      <span className="text-[11px] leading-[14px] font-normal whitespace-nowrap text-muted-foreground">
        {label}
      </span>
    </button>
  )
}

function BusySlot({ state, active }: { state: SlotState; active: boolean }) {
  const heightClass = state === 'empty'
    ? 'h-0.5'
    : state === 'partial'
      ? 'h-2'
      : 'h-3.5'
  let bgClass: string
  if (state === 'conflict') {
    bgClass = 'bg-status-error-icon'
  } else if (active) {
    if (state === 'empty') bgClass = 'bg-background/30'
    else if (state === 'partial') bgClass = 'bg-background/60'
    else bgClass = 'bg-background'
  } else {
    if (state === 'empty') bgClass = 'bg-border'
    else if (state === 'partial') bgClass = 'bg-muted-foreground'
    else bgClass = 'bg-foreground'
  }
  return <div className={cn('w-[7px] shrink-0 rounded-[1.5px]', heightClass, bgClass)} aria-hidden />
}

export default ActivitiesDayStrip
