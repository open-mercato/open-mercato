"use client"

import * as React from 'react'
import { format, parseISO } from 'date-fns'
import type { Locale } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'
import { Calendar } from '../../primitives/calendar'

export type DatePickerProps = {
  value?: Date | null
  onChange: (date: Date | null) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  className?: string
  locale?: Locale
  displayFormat?: string
  showTodayButton?: boolean
  showClearButton?: boolean
  closeOnSelect?: boolean
  minDate?: Date
  maxDate?: Date
}

const DAY_FIRST_LOCALE_CODES = new Set([
  'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'cs', 'sk', 'hu', 'ro',
])

function deriveDisplayFormat(locale?: Locale): string {
  if (!locale) return 'MMM d, yyyy'
  const code = locale.code?.split('-')[0]?.toLowerCase() ?? ''
  return DAY_FIRST_LOCALE_CODES.has(code) ? 'd MMM yyyy' : 'MMM d, yyyy'
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  disabled = false,
  readOnly = false,
  className,
  locale,
  displayFormat,
  showTodayButton = true,
  showClearButton = true,
  closeOnSelect = true,
  minDate,
  maxDate,
}: DatePickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const resolvedFormat = displayFormat ?? deriveDisplayFormat(locale)
  const placeholderText = placeholder ?? t('ui.datePicker.placeholder', 'Pick a date')
  const todayText = t('ui.datePicker.todayButton', 'Today')
  const clearText = t('ui.datePicker.clearButton', 'Clear')

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
      const next = new Date(day)
      next.setHours(0, 0, 0, 0)
      onChange(next)
      if (closeOnSelect) setOpen(false)
    },
    [onChange, closeOnSelect]
  )

  const handleToday = React.useCallback(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    onChange(today)
    setOpen(false)
  }, [onChange])

  const handleClear = React.useCallback(() => {
    onChange(null)
    setOpen(false)
  }, [onChange])

  const isInteractive = !disabled && !readOnly

  const disabledMatcher = React.useMemo(() => {
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
          disabled={disabledMatcher}
          initialFocus
        />
        {(showTodayButton || showClearButton) && (
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
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
      </PopoverContent>
    </Popover>
  )
}
