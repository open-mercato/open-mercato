"use client"

import * as React from 'react'
import { format } from 'date-fns'
import type { Locale } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Calendar } from './calendar'
import { Button } from './button'
import { LinkButton } from './link-button'
import { TimeInput } from '../backend/inputs/TimeInput'

export type DatePickerFooter = 'apply-cancel' | 'today-clear' | 'none'

export type DatePickerProps = {
  value?: Date | null
  onChange: (value: Date | null) => void
  placeholder?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  readOnly?: boolean
  /**
   * Footer mode in the popover.
   * - `'apply-cancel'` (default, Figma-aligned): selecting a day stages a draft;
   *   Apply commits and closes; Cancel reverts and closes.
   * - `'today-clear'`: legacy behavior — Today commits today, Clear sets null.
   * - `'none'`: no footer; selecting a day commits immediately and closes.
   */
  footer?: DatePickerFooter
  /**
   * Whether selecting a day commits the value and closes the popover.
   * - In `footer='apply-cancel'`: ignored (commit happens via Apply).
   * - In `footer='today-clear'`: default `true` for backward compatibility.
   * - In `footer='none'`: always `true` (popover always closes after selection).
   */
  closeOnSelect?: boolean
  /**
   * Whether to show the "Today" link in `footer='today-clear'` mode. Default `true`.
   * Only meaningful when `footer='today-clear'`.
   */
  showTodayButton?: boolean
  /**
   * Whether to show the "Clear" link in `footer='today-clear'` mode. Default `true`.
   * Only meaningful when `footer='today-clear'`.
   */
  showClearButton?: boolean
  withTime?: boolean
  minuteStep?: number
  align?: 'start' | 'center' | 'end'
  minDate?: Date
  maxDate?: Date
  locale?: Locale
  displayFormat?: string
  className?: string
  popoverClassName?: string
  id?: string
  name?: string
  required?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
}

const DAY_FIRST_LOCALE_CODES = new Set([
  'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'cs', 'sk', 'hu', 'ro',
])

function deriveDisplayFormat(locale: Locale | undefined, withTime: boolean): string {
  const code = locale?.code?.split('-')[0]?.toLowerCase() ?? ''
  const dateFmt = code && DAY_FIRST_LOCALE_CODES.has(code) ? 'd MMM yyyy' : 'MMM d, yyyy'
  return withTime ? `${dateFmt} HH:mm` : dateFmt
}

function extractTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function applyTimeToDate(base: Date, time: string): Date {
  const [hourStr = '0', minuteStr = '0'] = time.split(':')
  const hour = parseInt(hourStr, 10)
  const minute = parseInt(minuteStr, 10)
  const next = new Date(base)
  next.setHours(isNaN(hour) ? 0 : hour, isNaN(minute) ? 0 : minute, 0, 0)
  return next
}

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  size = 'default',
  disabled = false,
  readOnly = false,
  footer = 'apply-cancel',
  closeOnSelect,
  showTodayButton = true,
  showClearButton = true,
  withTime = false,
  minuteStep = 1,
  align = 'start',
  minDate,
  maxDate,
  locale,
  displayFormat,
  className,
  popoverClassName,
  id,
  name,
  required,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: DatePickerProps) {
  const resolvedCloseOnSelect = closeOnSelect ?? footer === 'today-clear'
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Date | null>(value ?? null)

  const isInteractive = !disabled && !readOnly
  const useDraft = footer === 'apply-cancel'

  React.useEffect(() => {
    if (open) setDraft(value ?? null)
  }, [open, value])

  const resolvedFormat = displayFormat ?? deriveDisplayFormat(locale, withTime)
  const placeholderText = placeholder ?? (
    withTime
      ? t('ui.dateTimePicker.placeholder', 'Pick date and time')
      : t('ui.datePicker.placeholder', 'Pick a date')
  )

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
      if (!day || !isInteractive) return
      const reference = withTime ? (useDraft ? draft : value) : null
      const base = withTime
        ? applyTimeToDate(day, reference ? extractTime(reference) : '00:00')
        : startOfDay(day)
      if (useDraft) {
        setDraft(base)
      } else {
        onChange(base)
        if (footer === 'none' || resolvedCloseOnSelect) setOpen(false)
      }
    },
    [isInteractive, withTime, useDraft, draft, value, footer, resolvedCloseOnSelect, onChange],
  )

  const handleTimeChange = React.useCallback(
    (time: string) => {
      const target = useDraft ? draft : value
      if (!target) return
      const next = applyTimeToDate(target, time)
      if (useDraft) setDraft(next)
      else onChange(next)
    },
    [useDraft, draft, value, onChange],
  )

  const handleApply = React.useCallback(() => {
    onChange(draft)
    setOpen(false)
  }, [draft, onChange])

  const handleCancel = React.useCallback(() => {
    setDraft(value ?? null)
    setOpen(false)
  }, [value])

  const handleToday = React.useCallback(() => {
    const today = withTime ? new Date() : startOfDay(new Date())
    onChange(today)
    setOpen(false)
  }, [withTime, onChange])

  const handleClear = React.useCallback(() => {
    onChange(null)
    setOpen(false)
  }, [onChange])

  const disabledMatcher = React.useMemo(() => {
    if (!minDate && !maxDate) return undefined
    const matchers: import('react-day-picker').Matcher[] = []
    if (minDate) matchers.push({ before: minDate })
    if (maxDate) matchers.push({ after: maxDate })
    return matchers
  }, [minDate, maxDate])

  const heightClass = size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm'
  const selectedDate = useDraft ? draft : value

  return (
    <Popover open={open} onOpenChange={isInteractive ? setOpen : undefined}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          name={name}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-haspopup="dialog"
          aria-required={required ? true : undefined}
          data-crud-focus-target=""
          data-slot="date-picker-trigger"
          disabled={disabled}
          className={cn(
            'w-full inline-flex items-center gap-2 rounded-md border border-input bg-background shadow-xs transition-colors text-left',
            'focus-visible:outline-none focus-visible:shadow-focus focus-visible:border-foreground',
            'hover:bg-muted/40',
            'disabled:bg-bg-disabled disabled:border-border-disabled disabled:shadow-none disabled:hover:bg-bg-disabled disabled:cursor-not-allowed',
            'aria-invalid:border-destructive',
            heightClass,
            readOnly && 'cursor-default opacity-70',
            !formattedValue && 'text-muted-foreground',
            className,
          )}
          onClick={isInteractive ? undefined : (event) => event.preventDefault()}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1 truncate">
            {formattedValue ?? placeholderText}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn('w-auto p-0', popoverClassName)}>
        <Calendar
          mode="single"
          selected={selectedDate ?? undefined}
          onSelect={handleDaySelect}
          locale={locale}
          disabled={disabledMatcher}
          initialFocus
        />
        {withTime && (
          <div className="flex items-center gap-2 border-t px-3 py-2">
            <span className="text-sm text-muted-foreground shrink-0">
              {t('ui.datePicker.timeLabel', 'Time')}:
            </span>
            <TimeInput
              value={selectedDate ? extractTime(selectedDate) : undefined}
              onChange={handleTimeChange}
              minuteStep={minuteStep}
              disabled={!isInteractive || !selectedDate}
            />
          </div>
        )}
        {footer === 'apply-cancel' && (
          <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
            <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
              {t('ui.datePicker.cancelButton', 'Cancel')}
            </Button>
            <Button type="button" size="sm" onClick={handleApply}>
              {t('ui.datePicker.applyButton', 'Apply')}
            </Button>
          </div>
        )}
        {footer === 'today-clear' && (showTodayButton || showClearButton) && (
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            {showTodayButton ? (
              <LinkButton type="button" variant="primary" onClick={handleToday}>
                {t('ui.datePicker.todayButton', 'Today')}
              </LinkButton>
            ) : null}
            {showClearButton ? (
              <LinkButton type="button" variant="gray" onClick={handleClear} className="ml-auto">
                {t('ui.datePicker.clearButton', 'Clear')}
              </LinkButton>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
