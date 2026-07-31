"use client"

import * as React from 'react'
import { DayPicker, useDayPicker } from 'react-day-picker'
import type { DayPickerProps, CalendarMonth } from 'react-day-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns/format'
import type { Locale } from 'date-fns/locale'
import { cn } from '@open-mercato/shared/lib/utils'

export type CalendarProps = DayPickerProps

const navButtonClassName = cn(
  'h-9 w-9 inline-flex items-center justify-center rounded-md shrink-0',
  'border border-border bg-background text-muted-foreground transition-colors',
  'hover:bg-accent hover:text-accent-foreground hover:border-input',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-background',
)

function MonthNavButton({
  direction,
  locale,
}: {
  direction: 'prev' | 'next'
  locale?: Locale
}) {
  const dayPicker = useDayPicker() as unknown as {
    previousMonth?: Date
    nextMonth?: Date
    goToMonth?: (month: Date) => void
  }
  const target = direction === 'prev' ? dayPicker.previousMonth : dayPicker.nextMonth
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight
  const targetLabel = format(target ?? new Date(), 'MMMM yyyy', locale ? { locale } : undefined)
  const ariaLabel = `Go to ${direction === 'prev' ? 'previous' : 'next'} month: ${targetLabel}`
  return (
    <button
      type="button"
      disabled={!target}
      aria-label={ariaLabel}
      onClick={() => {
        if (target && dayPicker.goToMonth) dayPicker.goToMonth(target)
      }}
      className={navButtonClassName}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

function buildMonthCaption(
  locale: Locale | undefined,
  totalMonths: number,
  onOpenMonthGrid: (() => void) | null,
) {
  return function MonthCaption({
    calendarMonth,
    displayIndex,
  }: {
    calendarMonth: CalendarMonth
    displayIndex?: number
  }) {
    const label = format(calendarMonth.date, 'MMMM yyyy', locale ? { locale } : undefined)
    const index = typeof displayIndex === 'number' ? displayIndex : 0
    // For multi-month layouts (e.g. range pickers) only the leftmost month
    // exposes the previous-month chevron and only the rightmost exposes the
    // next-month chevron. Navigation is always global across all visible
    // months, so showing both arrows on every month is confusing.
    const showPrev = index === 0
    const showNext = index === totalMonths - 1
    // The month grid (fast navigation) is only offered on single-month
    // calendars; on the leftmost caption it owns the click target.
    const labelInteractive = onOpenMonthGrid !== null && index === 0
    return (
      <div className="flex items-center justify-between gap-2 mb-3">
        {showPrev ? (
          <MonthNavButton direction="prev" locale={locale} />
        ) : (
          <div className="h-9 w-9 shrink-0" aria-hidden="true" />
        )}
        {labelInteractive ? (
          <button
            type="button"
            onClick={onOpenMonthGrid ?? undefined}
            aria-label={`${label} – open month and year navigation`}
            className={cn(
              'flex-1 flex items-center justify-center h-9 rounded-md bg-muted px-3 text-sm font-medium',
              'transition-colors hover:bg-accent hover:text-accent-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            {label}
          </button>
        ) : (
          <div
            className="flex-1 flex items-center justify-center h-9 rounded-md bg-muted px-3 text-sm font-medium"
            aria-live="polite"
          >
            {label}
          </div>
        )}
        {showNext ? (
          <MonthNavButton direction="next" locale={locale} />
        ) : (
          <div className="h-9 w-9 shrink-0" aria-hidden="true" />
        )}
      </div>
    )
  }
}

function MonthGrid({
  initialYear,
  selectedMonth,
  locale,
  onSelectMonth,
  onClose,
}: {
  initialYear: number
  selectedMonth: Date
  locale?: Locale
  onSelectMonth: (month: Date) => void
  onClose: () => void
}) {
  const [year, setYear] = React.useState(initialYear)
  const today = new Date()
  const monthLabels = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, monthIndex) =>
        format(new Date(year, monthIndex, 1), 'MMM', locale ? { locale } : undefined),
      ),
    [year, locale],
  )
  const yearLabel = format(new Date(year, 0, 1), 'yyyy', locale ? { locale } : undefined)
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col rounded-md bg-popover p-3"
      role="dialog"
      aria-label="Select month and year"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <button
          type="button"
          aria-label={`Go to previous year: ${year - 1}`}
          onClick={() => setYear((current) => current - 1)}
          className={navButtonClassName}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={`${yearLabel} – back to day selection`}
          className={cn(
            'flex-1 flex items-center justify-center h-9 rounded-md bg-muted px-3 text-sm font-medium',
            'transition-colors hover:bg-accent hover:text-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          {yearLabel}
        </button>
        <button
          type="button"
          aria-label={`Go to next year: ${year + 1}`}
          onClick={() => setYear((current) => current + 1)}
          className={navButtonClassName}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {monthLabels.map((monthLabel, monthIndex) => {
          const isSelected =
            selectedMonth.getFullYear() === year && selectedMonth.getMonth() === monthIndex
          const isCurrentMonth =
            today.getFullYear() === year && today.getMonth() === monthIndex
          return (
            <button
              key={monthIndex}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelectMonth(new Date(year, monthIndex, 1))}
              className={cn(
                'h-9 rounded-md text-sm font-normal transition-colors',
                'inline-flex items-center justify-center',
                'hover:bg-accent hover:text-accent-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isCurrentMonth && !isSelected && 'font-semibold text-primary',
                isSelected && '!bg-primary !text-primary-foreground hover:!bg-primary',
              )}
            >
              {monthLabel}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  fixedWeeks = true,
  locale,
  components,
  numberOfMonths = 1,
  pagedNavigation = true,
  month,
  defaultMonth,
  onMonthChange,
  ...props
}: CalendarProps) {
  // The month/year grid (fast navigation) is only meaningful for single-month
  // calendars; multi-month layouts (range pickers) keep the static caption.
  const monthGridEnabled = numberOfMonths === 1
  const [displayMonth, setDisplayMonth] = React.useState<Date>(
    () => month ?? defaultMonth ?? new Date(),
  )
  const [showMonthGrid, setShowMonthGrid] = React.useState(false)

  // Honor a controlled `month` prop when consumers drive navigation externally.
  React.useEffect(() => {
    if (month) setDisplayMonth(month)
  }, [month])

  const handleMonthChange = React.useCallback(
    (next: Date) => {
      setDisplayMonth(next)
      onMonthChange?.(next)
    },
    [onMonthChange],
  )

  const handleSelectMonth = React.useCallback(
    (next: Date) => {
      handleMonthChange(next)
      setShowMonthGrid(false)
    },
    [handleMonthChange],
  )

  const monthCaption = React.useMemo(
    () =>
      buildMonthCaption(
        locale as Locale | undefined,
        numberOfMonths,
        monthGridEnabled ? () => setShowMonthGrid(true) : null,
      ),
    [locale, numberOfMonths, monthGridEnabled],
  )

  return (
    <div className={monthGridEnabled ? 'relative' : 'contents'}>
      <div
        className={monthGridEnabled && showMonthGrid ? 'pointer-events-none' : 'contents'}
        aria-hidden={monthGridEnabled && showMonthGrid ? true : undefined}
      >
        <DayPicker
          showOutsideDays={showOutsideDays}
          fixedWeeks={fixedWeeks}
          pagedNavigation={pagedNavigation}
          locale={locale}
          numberOfMonths={numberOfMonths}
          month={displayMonth}
          onMonthChange={handleMonthChange}
          className={cn('p-3', className)}
          classNames={{
            months: 'flex flex-col sm:flex-row gap-4',
            month: 'space-y-2',
            month_caption: '',
            caption_label: 'sr-only',
            nav: 'sr-only',
            month_grid: 'w-full border-collapse',
            weekdays: 'flex',
            weekday: 'text-muted-foreground rounded-md w-9 font-normal text-xs',
            weeks: 'w-full border-collapse',
            week: 'flex w-full mt-1',
            day: 'h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
            day_button: cn(
              'h-9 w-9 p-0 font-normal aria-selected:opacity-100',
              'inline-flex items-center justify-center rounded-md text-sm',
              'transition-colors focus:outline-none focus-visible:outline-none disabled:pointer-events-none',
              // Focus indicator is a soft accent fill instead of a ring overlay — keyboard
              // users get a visible cue, but mouse-click focus does not leave a stuck ring
              // on top of the selected cell.
              'hover:bg-accent hover:text-accent-foreground',
              'focus-visible:bg-accent focus-visible:text-accent-foreground',
            ),
            // React-day-picker v9 applies `classNames.selected` / `range_*` to the day
            // CELL (`<td>`) wrapper, not to the inner `<button>`. To keep the parent
            // fill visible through interaction, we (a) paint the cell with the desired
            // bg/text, and (b) force the inner button to render transparent — so the
            // button's own hover/focus-visible bg overrides cannot cover the cell fill.
            selected: cn(
              '!bg-primary !text-primary-foreground rounded-md',
              '[&_button]:!bg-transparent [&_button]:!text-primary-foreground',
              '[&_button:hover]:!bg-transparent [&_button:hover]:!text-primary-foreground',
              '[&_button:focus-visible]:!bg-transparent [&_button:focus-visible]:!text-primary-foreground',
            ),
            range_start: cn(
              '!bg-primary !text-primary-foreground rounded-l-md !rounded-r-none',
              '[&_button]:!bg-transparent [&_button]:!text-primary-foreground',
              '[&_button:hover]:!bg-transparent [&_button:hover]:!text-primary-foreground',
              '[&_button:focus-visible]:!bg-transparent [&_button:focus-visible]:!text-primary-foreground',
            ),
            range_end: cn(
              '!bg-primary !text-primary-foreground rounded-r-md !rounded-l-none',
              '[&_button]:!bg-transparent [&_button]:!text-primary-foreground',
              '[&_button:hover]:!bg-transparent [&_button:hover]:!text-primary-foreground',
              '[&_button:focus-visible]:!bg-transparent [&_button:focus-visible]:!text-primary-foreground',
            ),
            range_middle: cn(
              '!bg-accent !text-accent-foreground !rounded-none',
              '[&_button]:!bg-transparent [&_button]:!text-accent-foreground',
              '[&_button:hover]:!bg-transparent [&_button:hover]:!text-accent-foreground',
              '[&_button:focus-visible]:!bg-transparent [&_button:focus-visible]:!text-accent-foreground',
            ),
            today: 'font-semibold text-primary rounded-md',
            outside:
              'day-outside text-muted-foreground opacity-40 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
            disabled: 'text-muted-foreground opacity-50',
            hidden: 'invisible',
            ...classNames,
          }}
          components={{
            MonthCaption: monthCaption,
            ...components,
          }}
          {...props}
        />
      </div>
      {monthGridEnabled && showMonthGrid ? (
        <MonthGrid
          initialYear={displayMonth.getFullYear()}
          selectedMonth={displayMonth}
          locale={locale as Locale | undefined}
          onSelectMonth={handleSelectMonth}
          onClose={() => setShowMonthGrid(false)}
        />
      ) : null}
    </div>
  )
}
