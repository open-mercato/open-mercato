"use client"

import * as React from 'react'
import { format } from 'date-fns'
import type { Locale } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'
import { Calendar } from '../../primitives/calendar'
import { TimeInput } from './TimeInput'

export type DateTimePickerProps = {
  value?: Date | null
  onChange: (date: Date | null) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  className?: string
  locale?: Locale
  displayFormat?: string
  minuteStep?: number
  showTodayButton?: boolean
  showClearButton?: boolean
  minDate?: Date
  maxDate?: Date
}

const DAY_FIRST_LOCALE_CODES = new Set([
  'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'cs', 'sk', 'hu', 'ro',
])

function deriveDisplayFormat(locale?: Locale): string {
  if (!locale) return 'MMM d, yyyy HH:mm'
  const code = locale.code?.split('-')[0]?.toLowerCase() ?? ''
  return DAY_FIRST_LOCALE_CODES.has(code) ? 'd MMM yyyy HH:mm' : 'MMM d, yyyy HH:mm'
}

function extractTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

function applyTimeToDate(base: Date, time: string): Date {
  const parts = time.split(':')
  const hour = parseInt(parts[0] ?? '0', 10)
  const minute = parseInt(parts[1] ?? '0', 10)
  const next = new Date(base)
  next.setHours(isNaN(hour) ? 0 : hour)
  next.setMinutes(isNaN(minute) ? 0 : minute)
  next.setSeconds(0)
  next.setMilliseconds(0)
  return next
}

export function DateTimePicker({
  value,
  onChange,
  placeholder,
  disabled = false,
  readOnly = false,
  className,
  locale,
  displayFormat,
  minuteStep = 1,
  showTodayButton = true,
  showClearButton = true,
  minDate,
  maxDate,
}: DateTimePickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const resolvedFormat = displayFormat ?? deriveDisplayFormat(locale)
  const placeholderText = placeholder ?? t('ui.dateTimePicker.placeholder', 'Pick date and time')
  const timeLabelText = t('ui.dateTimePicker.timeLabel', 'Time')
  const todayText = t('ui.dateTimePicker.todayButton', 'Today')
  const clearText = t('ui.dateTimePicker.clearButton', 'Clear')

  const formattedValue = React.useMemo(() => {
    if (!value) return null
    try {
      return format(value, resolvedFormat, locale ? { locale } : undefined)
    } catch {
      return null
    }
  }, [value, resolvedFormat, locale])

  const handleDaySelect = React.useCallback(
    (day: Date | undefined) => {
      if (!day) return
      const currentTime = value ? extractTime(value) : '00:00'
      onChange(applyTimeToDate(day, currentTime))
    },
    [onChange, value]
  )

  const handleTimeChange = React.useCallback(
    (time: string) => {
      const base = value ?? null
      if (!base) return
      onChange(applyTimeToDate(base, time))
    },
    [onChange, value]
  )

  const handleToday = React.useCallback(() => {
    const now = new Date()
    const currentTime = value ? extractTime(value) : extractTime(now)
    onChange(applyTimeToDate(now, currentTime))
    setOpen(false)
  }, [onChange, value])

  const handleClear = React.useCallback(() => {
    onChange(null)
    setOpen(false)
  }, [onChange])

  const isInteractive = !disabled && !readOnly

  const hiddenMatcher = React.useMemo(() => {
    if (!minDate && !maxDate) return undefined
    const matchers: import('react-day-picker').Matcher[] = []
    if (minDate) matchers.push({ before: minDate })
    if (maxDate) matchers.push({ after: maxDate })
    return matchers
  }, [minDate, maxDate])

  return (
    <Popover open={open} onOpenChange={isInteractive ? setOpen : undefined}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-crud-focus-target=""
          disabled={disabled}
          aria-haspopup="dialog"
          className={cn(
            'w-full h-9 flex items-center gap-2 rounded border px-3 text-sm text-left',
            'bg-background transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            'disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed',
            readOnly && 'cursor-default opacity-70',
            !formattedValue && 'text-muted-foreground',
            className
          )}
          onClick={isInteractive ? undefined : (e) => e.preventDefault()}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">
            {formattedValue ?? placeholderText}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-auto">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          onSelect={handleDaySelect}
          locale={locale}
          disabled={hiddenMatcher}
          initialFocus
        />
        <div className="border-t px-3 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground shrink-0">{timeLabelText}:</span>
            <TimeInput
              value={value ? extractTime(value) : undefined}
              onChange={handleTimeChange}
              minuteStep={minuteStep}
            />
          </div>
          {(showTodayButton || showClearButton) && (
            <div className="flex items-center justify-between gap-2">
              {showTodayButton && (
                <button
                  type="button"
                  onClick={handleToday}
                  className="text-sm text-primary hover:underline focus:outline-none"
                >
                  {todayText}
                </button>
              )}
              {showClearButton && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-sm text-muted-foreground hover:text-foreground hover:underline focus:outline-none ml-auto"
                >
                  {clearText}
                </button>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
