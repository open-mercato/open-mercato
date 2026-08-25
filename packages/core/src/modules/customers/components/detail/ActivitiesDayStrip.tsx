'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toZonedTime } from 'date-fns-tz'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { InteractionSummary } from './types'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

interface ActivitiesDayStripProps {
  entityId: string
  selectedDate: Date
  onSelectDate: (date: Date) => void
  refreshKey?: number
  /** Rendered at the left edge of the strip's single header row (card title). */
  headerLeft?: React.ReactNode
  /** Rendered after the week controls (card actions, e.g. Add new). */
  headerRight?: React.ReactNode
  /**
   * Optional pre-fetched events. When provided, the day strip skips its own fetch
   * and uses the supplied list, ensuring its busyness count agrees with the
   * activity list rendered alongside it (issue #1809 — E1 status filter alignment).
   */
  events?: InteractionSummary[]
}

const USER_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

// Project a UTC ISO timestamp to the user's local timezone before comparing
// "same day" (issue #1809 — E3). The browser's `new Date(iso)` treats the
// instant correctly, but `getDate()/getMonth()/getFullYear()` reflect the
// user's local day, so for activities scheduled at e.g. 23:30 local on a UTC
// boundary the day-strip and list now agree.
function toLocalZonedDate(value: string | Date): Date {
  return toZonedTime(value, USER_TIMEZONE)
}

const VISIBLE_DAYS = 7

const DAY_LABEL_KEYS: Array<[number, string, string]> = [
  [0, 'customers.calendar.day.sun', 'SUN'],
  [1, 'customers.calendar.day.mon', 'MON'],
  [2, 'customers.calendar.day.tue', 'TUE'],
  [3, 'customers.calendar.day.wed', 'WED'],
  [4, 'customers.calendar.day.thu', 'THU'],
  [5, 'customers.calendar.day.fri', 'FRI'],
  [6, 'customers.calendar.day.sat', 'SAT'],
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

// Anchor the visible window to the Monday of the focal date's week, so the
// strip always reads as a calendar week (Mon..Sun).
function anchorCenteredOn(focalDate: Date): Date {
  const day = focalDate.getDay()
  const sinceMonday = (day + 6) % 7
  return startOfDay(addDays(focalDate, -sinceMonday))
}


function formatDayLabel(date: Date, t: TranslateFn): string {
  const entry = DAY_LABEL_KEYS.find(([index]) => index === date.getDay())
  return entry ? t(entry[1], entry[2]) : ''
}

export function ActivitiesDayStrip({ entityId, selectedDate, onSelectDate, refreshKey = 0, headerLeft, headerRight, events: providedEvents }: ActivitiesDayStripProps) {
  const t = useT()
  const [anchor, setAnchor] = React.useState<Date>(() => anchorCenteredOn(selectedDate))
  const [fetchedEvents, setFetchedEvents] = React.useState<InteractionSummary[]>([])
  // When the parent supplies `events` (preferred path — keeps day strip and
  // the list in lockstep, fixes #1809 E1), skip the local fetch entirely.
  const useProvidedEvents = providedEvents !== undefined
  const events = useProvidedEvents ? providedEvents : fetchedEvents

  React.useEffect(() => {
    setAnchor((current) => {
      const days = buildVisibleDays(current)
      const visible = days.some((day) => isSameDay(day, selectedDate))
      if (visible) return current
      return anchorCenteredOn(selectedDate)
    })
  }, [selectedDate])

  const visibleDays = React.useMemo(() => buildVisibleDays(anchor), [anchor])
  const headerLabel = React.useMemo(() => formatRangeLabel(visibleDays), [visibleDays])

  React.useEffect(() => {
    if (useProvidedEvents) return
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
        setFetchedEvents(Array.isArray(payload?.items) ? payload.items : [])
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') return
        logger.warn('failed to load interactions', { component: 'ActivitiesDayStrip', err })
        setFetchedEvents([])
      }
    })()
    return () => controller.abort()
  }, [entityId, visibleDays, refreshKey, useProvidedEvents])

  const todayDate = React.useMemo(() => startOfDay(new Date()), [])

  const handlePrev = React.useCallback(() => {
    setAnchor((current) => addDays(current, -VISIBLE_DAYS))
  }, [])
  const handleNext = React.useCallback(() => {
    setAnchor((current) => addDays(current, VISIBLE_DAYS))
  }, [])

  const selectedIso = formatDayIso(selectedDate)

  const handleToday = React.useCallback(() => {
    onSelectDate(startOfDay(new Date()))
  }, [onSelectDate])

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Single header row: card title on the left, week controls + card
          actions on the right — the separate title and nav rows left a band
          of dead space across the top of the card. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {headerLeft ? <div className="flex min-w-0 items-center gap-2">{headerLeft}</div> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrev}
            aria-label={t('customers.activities.calendar.prevWindow', 'Previous days')}
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card shadow-xs hover:bg-accent/40"
          >
            <ChevronLeft className="size-4 text-foreground" />
          </button>
          <span className="whitespace-nowrap text-sm font-medium text-foreground">
            {headerLabel}
          </span>
          <button
            type="button"
            onClick={handleNext}
            aria-label={t('customers.activities.calendar.nextWindow', 'Next days')}
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card shadow-xs hover:bg-accent/40"
          >
            <ChevronRight className="size-4 text-foreground" />
          </button>
          <Button type="button" variant="outline" onClick={handleToday}>
            {t('customers.activities.calendar.today', 'Today')}
          </Button>
          {headerRight}
        </div>
      </div>
      {/* Reference-style week strip: one muted track, the selected day lifts as
          a white tile (DS SegmentedControl geometry; heights overridden for the
          two-line day cells). */}
      <SegmentedControl
        value={selectedIso}
        onValueChange={(next) => {
          const parsed = new Date(`${next}T00:00:00`)
          if (!Number.isNaN(parsed.getTime())) onSelectDate(parsed)
        }}
        aria-label={t('customers.activities.calendar.weekStrip', 'Pick a day')}
        className="h-auto w-full min-w-0"
      >
        {visibleDays.map((day) => {
          const iso = formatDayIso(day)
          const isToday = isSameDay(day, todayDate)
          const eventCount = events.filter((event) => {
            const startIso = event.scheduledAt ?? event.occurredAt ?? event.createdAt
            return Boolean(startIso) && isSameDay(toLocalZonedDate(startIso as string), day)
          }).length
          return (
            <SegmentedControlItem
              key={iso}
              value={iso}
              aria-label={`${formatDayLabel(day, t)} ${day.getDate()}`}
              className={cn(
                'h-auto min-w-0 flex-1 flex-col gap-1.5 px-1 py-3',
                // Today reads as a violet-tinted tile (unless it is the selected
                // white one), replacing the old dot beside the number.
                isToday && 'data-[state=unchecked]:bg-brand-violet/10',
              )}
            >
              <span className="text-xs font-medium leading-none tracking-wide text-muted-foreground">
                {formatDayLabel(day, t)}
              </span>
              <span className="text-xl font-semibold leading-7 text-foreground">{day.getDate()}</span>
              <span className="whitespace-nowrap text-[11px] leading-none text-muted-foreground">
                {/* Narrow cells fit only the bare count; the full label returns from sm up. */}
                <span className="sm:hidden">{eventCount > 0 ? eventCount : '\u00A0'}</span>
                <span className="hidden sm:inline">
                  {eventCount === 0
                    ? t('customers.activities.calendar.none', 'None')
                    : eventCount === 1
                      ? t('customers.activities.calendar.countOne', '1 activity')
                      : t('customers.activities.calendar.countMany', '{count} activities', { count: eventCount })}
                </span>
              </span>
              {/* Dot row mirrors the count (max three); always rendered so empty
                  days keep equal cell height. */}
              <span className="flex h-2 items-center gap-1" aria-hidden>
                {Array.from({ length: Math.min(eventCount, 3) }, (_, dotIndex) => (
                  <span key={dotIndex} className="size-1 rounded-full bg-brand-violet" />
                ))}
              </span>
            </SegmentedControlItem>
          )
        })}
      </SegmentedControl>
    </div>
  )
}

function formatRangeLabel(days: Date[]): string {
  if (days.length === 0) return ''
  const first = days[0]
  const last = days[days.length - 1]
  const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' })
  const year = last.getFullYear()
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return `${first.getDate()}–${dayMonth.format(last)} ${year}`
  }
  return `${dayMonth.format(first)} – ${dayMonth.format(last)} ${year}`
}

function formatDayIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default ActivitiesDayStrip
