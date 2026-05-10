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
import type { DateRange } from '../backend/date-range/dateRanges'
import {
  defaultDateRangePresets,
  type DateRangePresetItem,
} from './date-picker-helpers'

export type { DateRangePresetItem } from './date-picker-helpers'

export type DateRangePickerProps = {
  value?: DateRange | null
  onChange: (value: DateRange | null) => void
  presets?: DateRangePresetItem[]
  showPresets?: boolean
  placeholder?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  readOnly?: boolean
  withFooter?: boolean
  align?: 'start' | 'center' | 'end'
  minDate?: Date
  maxDate?: Date
  numberOfMonths?: 1 | 2
  locale?: Locale
  formatRange?: (value: DateRange, locale?: Locale) => string
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

function deriveDateFormat(locale?: Locale): string {
  const code = locale?.code?.split('-')[0]?.toLowerCase() ?? ''
  return code && DAY_FIRST_LOCALE_CODES.has(code) ? 'd MMM yyyy' : 'MMM d, yyyy'
}

function defaultFormatRange(range: DateRange, locale?: Locale): string {
  const fmt = deriveDateFormat(locale)
  const opts = locale ? { locale } : undefined
  return `${format(range.start, fmt, opts)} – ${format(range.end, fmt, opts)}`
}

type RDPRange = { from?: Date; to?: Date }

function toRDPRange(range: DateRange | null | undefined): RDPRange | undefined {
  if (!range) return undefined
  return { from: range.start, to: range.end }
}

function fromRDPRange(rdp: RDPRange | undefined): DateRange | null {
  if (!rdp || !rdp.from) return null
  return { start: rdp.from, end: rdp.to ?? rdp.from }
}

function rangesEqual(a: DateRange | null, b: DateRange | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime()
}

export function DateRangePicker({
  value,
  onChange,
  presets,
  showPresets = true,
  placeholder,
  size = 'default',
  disabled = false,
  readOnly = false,
  withFooter = true,
  align = 'start',
  minDate,
  maxDate,
  numberOfMonths = 2,
  locale,
  formatRange,
  className,
  popoverClassName,
  id,
  name,
  required,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: DateRangePickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<DateRange | null>(value ?? null)
  const [activePresetId, setActivePresetId] = React.useState<string | null>(null)

  const isInteractive = !disabled && !readOnly
  const useDraft = withFooter

  React.useEffect(() => {
    if (open) {
      setDraft(value ?? null)
      setActivePresetId(null)
    }
  }, [open, value])

  const resolvedPresets = React.useMemo<DateRangePresetItem[]>(
    () => presets ?? defaultDateRangePresets(),
    [presets],
  )

  const placeholderText = placeholder ?? t('ui.dateRangePicker.placeholder', 'Pick a date range')
  const formatter = formatRange ?? defaultFormatRange
  const formattedValue = React.useMemo(() => {
    if (!value) return null
    return formatter(value, locale)
  }, [value, formatter, locale])

  const selectedDate = useDraft ? draft : value
  const rdpSelected = toRDPRange(selectedDate)

  const handleRangeSelect = React.useCallback(
    (rdpRange: RDPRange | undefined) => {
      if (!isInteractive) return
      const next = fromRDPRange(rdpRange)
      setActivePresetId(null)
      if (useDraft) {
        setDraft(next)
      } else {
        onChange(next)
        if (next?.start && next?.end) setOpen(false)
      }
    },
    [isInteractive, useDraft, onChange],
  )

  const handlePresetClick = React.useCallback(
    (preset: DateRangePresetItem) => {
      if (!isInteractive) return
      const range = preset.range()
      setActivePresetId(preset.id)
      if (useDraft) {
        setDraft(range)
      } else {
        onChange(range)
        setOpen(false)
      }
    },
    [isInteractive, useDraft, onChange],
  )

  const handleApply = React.useCallback(() => {
    onChange(draft)
    setOpen(false)
  }, [draft, onChange])

  const handleCancel = React.useCallback(() => {
    setDraft(value ?? null)
    setActivePresetId(null)
    setOpen(false)
  }, [value])

  const disabledMatcher = React.useMemo(() => {
    if (!minDate && !maxDate) return undefined
    const matchers: import('react-day-picker').Matcher[] = []
    if (minDate) matchers.push({ before: minDate })
    if (maxDate) matchers.push({ after: maxDate })
    return matchers
  }, [minDate, maxDate])

  const heightClass = size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm'

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
          data-slot="date-range-picker-trigger"
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
      <PopoverContent
        align={align}
        className={cn(
          'w-auto p-0 flex flex-col overflow-hidden',
          'max-h-[var(--radix-popover-content-available-height)]',
          popoverClassName,
        )}
      >
        <div className="flex min-h-0 flex-1 overflow-auto">
          {showPresets ? (
            <div
              data-slot="date-range-presets"
              className="flex w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2"
            >
              {resolvedPresets.map((preset) => {
                const isActive = activePresetId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className={cn(
                      'inline-flex h-8 items-center rounded-md px-3 text-left text-sm transition-colors shrink-0',
                      'hover:bg-accent hover:text-accent-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      isActive && 'bg-muted font-medium text-foreground',
                    )}
                  >
                    {t(preset.labelKey, preset.id.replace(/_/g, ' '))}
                  </button>
                )
              })}
            </div>
          ) : null}
          <div className="p-3">
            <Calendar
              mode="range"
              selected={rdpSelected}
              onSelect={handleRangeSelect}
              locale={locale}
              disabled={disabledMatcher}
              numberOfMonths={numberOfMonths}
              initialFocus
            />
          </div>
        </div>
        {withFooter ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-popover px-3 py-2">
            <span className="truncate text-xs text-muted-foreground">
              {selectedDate
                ? `${t('ui.dateRangePicker.rangeLabel', 'Range')}: ${formatter(selectedDate, locale)}`
                : t('ui.dateRangePicker.rangeEmpty', 'No range selected')}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                {t('ui.dateRangePicker.cancelButton', 'Cancel')}
              </Button>
              <Button type="button" size="sm" onClick={handleApply}>
                {t('ui.dateRangePicker.applyButton', 'Apply')}
              </Button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
