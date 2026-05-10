"use client"

import * as React from 'react'
import { DayPicker, useDayPicker } from 'react-day-picker'
import type { DayPickerProps, CalendarMonth } from 'react-day-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import type { Locale } from 'date-fns'
import { cn } from '@open-mercato/shared/lib/utils'

export type CalendarProps = DayPickerProps

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
      className={cn(
        'h-9 w-9 inline-flex items-center justify-center rounded-md shrink-0',
        'border border-border bg-background text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground hover:border-input',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-background',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

function buildMonthCaption(locale: Locale | undefined, totalMonths: number) {
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
    return (
      <div className="flex items-center justify-between gap-2 mb-3">
        {showPrev ? (
          <MonthNavButton direction="prev" locale={locale} />
        ) : (
          <div className="h-9 w-9 shrink-0" aria-hidden="true" />
        )}
        <div
          className="flex-1 flex items-center justify-center h-9 rounded-md bg-muted px-3 text-sm font-medium"
          aria-live="polite"
        >
          {label}
        </div>
        {showNext ? (
          <MonthNavButton direction="next" locale={locale} />
        ) : (
          <div className="h-9 w-9 shrink-0" aria-hidden="true" />
        )}
      </div>
    )
  }
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
  ...props
}: CalendarProps) {
  const monthCaption = React.useMemo(
    () => buildMonthCaption(locale as Locale | undefined, numberOfMonths),
    [locale, numberOfMonths],
  )
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      fixedWeeks={fixedWeeks}
      pagedNavigation={pagedNavigation}
      locale={locale}
      numberOfMonths={numberOfMonths}
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
          'ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none',
          'hover:bg-accent hover:text-accent-foreground',
        ),
        selected:
          '!bg-primary !text-primary-foreground hover:!bg-primary hover:!text-primary-foreground focus:!bg-primary focus:!text-primary-foreground rounded-md',
        range_start:
          '!bg-primary !text-primary-foreground hover:!bg-primary hover:!text-primary-foreground rounded-l-md !rounded-r-none',
        range_end:
          '!bg-primary !text-primary-foreground hover:!bg-primary hover:!text-primary-foreground rounded-r-md !rounded-l-none',
        range_middle:
          '!bg-accent !text-accent-foreground hover:!bg-accent hover:!text-accent-foreground !rounded-none',
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
  )
}
