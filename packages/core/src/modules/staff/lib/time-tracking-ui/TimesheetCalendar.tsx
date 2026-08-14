"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDuration } from '../time-tracking/duration'
import {
  buildCalendarWeeks,
  formatPeriodLabel,
  parseIsoDay,
  type TimesheetCalendarCell,
} from './timesheetPeriod'
import { entryChipLabel, loadPercent, type TimesheetDayIndex, type TimesheetEntry } from './timesheetData'

/**
 * Screen 11 — the month calendar (T5.2).
 *
 * The mockup's four notes are the four things this component exists to do:
 *
 *  1. **A load bar under the date** so light and heavy days read without reading
 *     numbers (note 1, US-E3). Its scale comes from the caller, which is what
 *     lets note 6 work: with `targets.dailyHours` set the bar is "% of target",
 *     without it the bars are ranked against the longest day of the period.
 *  2. **`+ dodaj` on hover** opens the shared entry dialog pre-dated to that day
 *     (note 2, US-E4). It is rendered for every in-period day and revealed on
 *     hover *or keyboard focus* — a hover-only affordance would put adding time
 *     out of reach of anybody not using a mouse.
 *  3. **A non-billable chip is dashed, not coloured** (note 3), so the
 *     distinction survives greyscale and colour blindness. The chip also carries
 *     a `title`, so the meaning is available to a screen reader rather than
 *     living in a border style.
 *  4. Periods longer than a month render one grid per month rather than a
 *     disabled switch. A quarter and a year are the same question as a month,
 *     asked over more days.
 */

export type TimesheetCalendarProps = {
  /** One anchor day per month to render, in order. */
  monthAnchors: readonly string[]
  days: TimesheetDayIndex
  scaleMinutes: number | null
  todayDate: string
  onAddEntry: (date: string) => void
  onSelectEntry: (entry: TimesheetEntry) => void
  locale?: string
  /** Multi-month periods get a heading per grid; a single month does not need one. */
  showMonthHeadings?: boolean
}

function weekdayLabels(locale: string | undefined): string[] {
  // 2024-01-01 was a Monday, so the seven days from it are Mon…Sun in order.
  const base = new Date(2024, 0, 1)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + index)
    try {
      return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(day)
    } catch {
      return String(index)
    }
  })
}

export function TimesheetCalendar({
  monthAnchors,
  days,
  scaleMinutes,
  todayDate,
  onAddEntry,
  onSelectEntry,
  locale,
  showMonthHeadings = false,
}: TimesheetCalendarProps) {
  const t = useT()
  const weekdays = React.useMemo(() => weekdayLabels(locale), [locale])
  const addLabel = t('staff.time_tracking.timesheet.calendar.add', '+ add')
  const nonBillableLabel = t('staff.time_tracking.timesheet.calendar.nonBillable', 'Non-billable')

  return (
    <div className="flex flex-col gap-6">
      {monthAnchors.map((anchor) => (
        <section key={anchor} className="flex flex-col gap-2">
          {showMonthHeadings ? (
            <h3 className="text-sm font-semibold text-foreground">{formatPeriodLabel('month', anchor, locale)}</h3>
          ) : null}
          <div className="grid grid-cols-7 gap-1">
            {weekdays.map((label) => (
              <div key={label} className="px-1 pb-1 text-xs font-medium uppercase text-muted-foreground">
                {label}
              </div>
            ))}
            {buildCalendarWeeks(anchor, todayDate)
              .flat()
              .map((cell) => (
                <CalendarDayCell
                  key={cell.date}
                  cell={cell}
                  day={days.get(cell.date) ?? null}
                  scaleMinutes={scaleMinutes}
                  addLabel={addLabel}
                  nonBillableLabel={nonBillableLabel}
                  onAddEntry={onAddEntry}
                  onSelectEntry={onSelectEntry}
                  locale={locale}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function CalendarDayCell({
  cell,
  day,
  scaleMinutes,
  addLabel,
  nonBillableLabel,
  onAddEntry,
  onSelectEntry,
  locale,
}: {
  cell: TimesheetCalendarCell
  day: { totalMinutes: number; entries: TimesheetEntry[] } | null
  scaleMinutes: number | null
  addLabel: string
  nonBillableLabel: string
  onAddEntry: (date: string) => void
  onSelectEntry: (entry: TimesheetEntry) => void
  locale?: string
}) {
  const totalMinutes = day?.totalMinutes ?? 0
  const entries = day?.entries ?? []
  const percent = loadPercent(totalMinutes, scaleMinutes)
  const parsed = parseIsoDay(cell.date)
  const fullDate = parsed
    ? (() => {
        try {
          return new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(parsed)
        } catch {
          return cell.date
        }
      })()
    : cell.date

  return (
    <div
      className={cn(
        'group flex min-h-24 flex-col gap-1 rounded-md border p-1.5 transition-colors',
        cell.inPeriod ? 'bg-card' : 'bg-muted/40 text-muted-foreground',
        cell.isWeekend && cell.inPeriod ? 'bg-muted/30' : null,
        cell.isToday ? 'border-primary' : 'border-border',
      )}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className={cn('text-xs', cell.isToday ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
          {cell.dayOfMonth}
        </span>
        {totalMinutes > 0 ? (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatDuration(totalMinutes, 'clock')}
          </span>
        ) : null}
      </div>

      {cell.inPeriod && totalMinutes > 0 ? <Progress value={percent} size="sm" /> : null}

      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelectEntry(entry)}
          title={entry.isBillable ? undefined : nonBillableLabel}
          className={cn(
            'flex w-full items-center justify-between gap-1 rounded px-1 py-0.5 text-left text-xs',
            'hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            entry.isBillable ? 'border border-transparent bg-muted/60' : 'border border-dashed border-border',
          )}
        >
          <span className="min-w-0 truncate">{entryChipLabel(entry, '—')}</span>
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
            {formatDuration(entry.durationMinutes, 'clock')}
          </span>
        </button>
      ))}

      {cell.inPeriod ? (
        <button
          type="button"
          onClick={() => onAddEntry(cell.date)}
          aria-label={`${addLabel} — ${fullDate}`}
          className={cn(
            'mt-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-muted-foreground',
            'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <Plus className="size-3" aria-hidden="true" />
          {addLabel}
        </button>
      ) : null}
    </div>
  )
}
