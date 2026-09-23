"use client"

import * as React from 'react'
import { DateRangePicker } from '../../primitives/date-range-picker'
import { IconButton } from '../../primitives/icon-button'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '../../primitives/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select'
import type { ScheduleRange, ScheduleViewMode } from './types'
import { cn } from '@open-mercato/shared/lib/utils'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { addDays } from 'date-fns/addDays'
import { addMonths } from 'date-fns/addMonths'
import { addWeeks } from 'date-fns/addWeeks'
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays'
import { endOfDay } from 'date-fns/endOfDay'
import { endOfMonth } from 'date-fns/endOfMonth'
import { endOfWeek } from 'date-fns/endOfWeek'
import { format } from 'date-fns/format'
import { startOfDay } from 'date-fns/startOfDay'
import { startOfMonth } from 'date-fns/startOfMonth'
import { startOfWeek } from 'date-fns/startOfWeek'
import { getScheduleLocale } from './localization'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const VIEW_OPTIONS: Array<{ id: ScheduleViewMode; labelKey: string; fallback: string }> = [
  { id: 'day', labelKey: 'schedule.view.day', fallback: 'Day' },
  { id: 'week', labelKey: 'schedule.view.week', fallback: 'Week' },
  { id: 'month', labelKey: 'schedule.view.month', fallback: 'Month' },
  { id: 'agenda', labelKey: 'schedule.view.agenda', fallback: 'Agenda' },
]

function getTimezoneOptions(current?: string): string[] {
  const options = new Set<string>()
  if (current) options.add(current)
  options.add('UTC')
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (resolved) options.add(resolved)
  const intlWithSupportedValues = Intl as typeof Intl & { supportedValuesOf?: (input: 'timeZone') => string[] }
  if (typeof intlWithSupportedValues.supportedValuesOf === 'function') {
    intlWithSupportedValues.supportedValuesOf('timeZone').forEach((timezone) => {
      if (timezone) options.add(timezone)
    })
  }
  return Array.from(options).sort((a, b) => a.localeCompare(b))
}

export type ScheduleToolbarProps = {
  view: ScheduleViewMode
  range: ScheduleRange
  timezone?: string
  onViewChange: (view: ScheduleViewMode) => void
  onRangeChange: (range: ScheduleRange) => void
  onTimezoneChange?: (timezone: string) => void
  className?: string
}

export function ScheduleToolbar({
  view,
  range,
  timezone,
  onViewChange,
  onRangeChange,
  onTimezoneChange,
  className,
}: ScheduleToolbarProps) {
  const t = useT()
  const locale = getScheduleLocale(useOptionalLocale())
  const rangeLength = React.useMemo(
    () => Math.max(1, differenceInCalendarDays(range.end, range.start) + 1),
    [range.end, range.start],
  )
  const deriveRangeForView = React.useCallback((base: Date, nextView: ScheduleViewMode): ScheduleRange => {
    if (nextView === 'day') {
      const start = startOfDay(base)
      return { start, end: endOfDay(start) }
    }
    if (nextView === 'week') {
      return { start: startOfWeek(base, { locale }), end: endOfWeek(base, { locale }) }
    }
    if (nextView === 'month') {
      return { start: startOfMonth(base), end: endOfMonth(base) }
    }
    const start = startOfDay(base)
    return { start, end: endOfDay(addDays(start, rangeLength - 1)) }
  }, [locale, rangeLength])
  const formatRange = React.useCallback((selected: ScheduleRange) => {
    if (view === 'day') return format(selected.start, 'PPP', { locale })
    if (view === 'month') return format(selected.start, 'LLLL yyyy', { locale })
    return new Intl.DateTimeFormat(locale.code, {
      day: 'numeric', month: 'short', year: 'numeric',
    }).formatRange(selected.start, selected.end)
  }, [locale, view])

  const shiftRange = React.useCallback((direction: 'prev' | 'next') => {
    const multiplier = direction === 'prev' ? -1 : 1
    if (view === 'day') {
      const nextStart = startOfDay(addDays(range.start, multiplier))
      onRangeChange({ start: nextStart, end: endOfDay(nextStart) })
      return
    }
    if (view === 'week') {
      const base = addWeeks(range.start, multiplier)
      onRangeChange({
        start: startOfWeek(base, { locale }),
        end: endOfWeek(base, { locale }),
      })
      return
    }
    if (view === 'month') {
      const base = addMonths(range.start, multiplier)
      onRangeChange({ start: startOfMonth(base), end: endOfMonth(base) })
      return
    }
    const nextStart = startOfDay(addDays(range.start, multiplier * rangeLength))
    onRangeChange({ start: nextStart, end: endOfDay(addDays(nextStart, rangeLength - 1)) })
  }, [locale, onRangeChange, range.start, rangeLength, view])

  const timezoneOptions = React.useMemo(() => getTimezoneOptions(timezone), [timezone])

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <SegmentedControl
        value={view}
        onValueChange={(value) => {
          const nextView = value as ScheduleViewMode
          if (nextView === view) return
          onViewChange(nextView)
          onRangeChange(deriveRangeForView(range.start, nextView))
        }}
        aria-label={t('schedule.view.label', 'Schedule view')}
        className="shrink-0"
      >
        {VIEW_OPTIONS.map((option) => (
          <SegmentedControlItem key={option.id} value={option.id}>
            {t(option.labelKey, option.fallback)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          type="button"
          variant="outline"
          onClick={() => shiftRange('prev')}
          aria-label={t('schedule.range.prev', 'Previous')}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </IconButton>
        <DateRangePicker
          value={range}
          onChange={(next) => {
            if (!next) return
            onRangeChange({ start: startOfDay(next.start), end: endOfDay(next.end) })
          }}
          locale={locale}
          formatRange={formatRange}
          className="w-auto min-w-0 font-medium"
          size="sm"
          showPresets={false}
          numberOfMonths={2}
          aria-label={t('schedule.range.label', 'Date range')}
        />
        <IconButton
          type="button"
          variant="outline"
          onClick={() => shiftRange('next')}
          aria-label={t('schedule.range.next', 'Next')}
        >
          <ChevronRight className="size-4" aria-hidden />
        </IconButton>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 md:ml-auto">
        {onTimezoneChange ? (
          <Select value={timezone ?? undefined} onValueChange={onTimezoneChange}>
            <SelectTrigger
              size="sm"
              className="w-auto min-w-40"
              aria-label={t('schedule.range.timezone', 'Timezone')}
            >
              <SelectValue placeholder={t('schedule.range.timezone.placeholder', 'UTC')} />
            </SelectTrigger>
            <SelectContent>
              {timezoneOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  )
}
