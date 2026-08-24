'use client'

import * as React from 'react'
import { Globe, Repeat } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { TimePicker } from '@open-mercato/ui/backend/inputs/TimePicker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible, getFieldLabel } from './fieldConfig'

function parseIsoDate(value: string): Date | null {
  if (!value) return null
  const parts = value.split('-')
  if (parts.length !== 3) return null
  const [y, m, d] = parts.map((p) => parseInt(p, 10))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatIsoDate(date: Date | null): string {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const DURATION_OPTIONS: Array<{ value: number; key: string; fallback: string }> = [
  { value: 15, key: 'customers.schedule.duration.option.15min', fallback: '15 min' },
  { value: 30, key: 'customers.schedule.duration.option.30min', fallback: '30 min' },
  { value: 45, key: 'customers.schedule.duration.option.45min', fallback: '45 min' },
  { value: 60, key: 'customers.schedule.duration.option.1hour', fallback: '1 hour' },
  { value: 90, key: 'customers.schedule.duration.option.1h30m', fallback: '1h 30m' },
  { value: 120, key: 'customers.schedule.duration.option.2hours', fallback: '2 hours' },
]
// Monday-first render order; labels come from the same locale keys the
// activities day strip uses, so PL shows PN/WT/SR instead of Mo/Tu/We.
const RECURRENCE_DAY_KEYS: Array<[string, string]> = [
  ['customers.calendar.day.mon', 'MON'],
  ['customers.calendar.day.tue', 'TUE'],
  ['customers.calendar.day.wed', 'WED'],
  ['customers.calendar.day.thu', 'THU'],
  ['customers.calendar.day.fri', 'FRI'],
  ['customers.calendar.day.sat', 'SAT'],
  ['customers.calendar.day.sun', 'SUN'],
]

interface DateTimeFieldsProps {
  visible: Set<ScheduleFieldId>
  activityType: ActivityType
  date: string
  setDate: (value: string) => void
  startTime: string
  setStartTime: (value: string) => void
  duration: number
  setDuration: (value: number) => void
  allDay: boolean
  setAllDay: (value: boolean) => void
  recurrenceEnabled: boolean
  setRecurrenceEnabled: (value: boolean) => void
  recurrenceDays: boolean[]
  toggleRecurrenceDay: (index: number) => void
  recurrenceEndType: 'never' | 'count' | 'date'
  setRecurrenceEndType: (value: 'never' | 'count' | 'date') => void
  recurrenceCount: number
  setRecurrenceCount: (value: number) => void
  recurrenceEndDate: string
  setRecurrenceEndDate: (value: string) => void
}

export function DateTimeFields({
  visible,
  activityType,
  date,
  setDate,
  startTime,
  setStartTime,
  duration,
  setDuration,
  allDay,
  setAllDay,
  recurrenceEnabled,
  setRecurrenceEnabled,
  recurrenceDays,
  toggleRecurrenceDay,
  recurrenceEndType,
  setRecurrenceEndType,
  recurrenceCount,
  setRecurrenceCount,
  recurrenceEndDate,
  setRecurrenceEndDate,
}: DateTimeFieldsProps) {
  const t = useT()

  if (!visible.has('date')) return null

  const showStartTime = isVisible(activityType, 'startTime')
  const showDuration = isVisible(activityType, 'duration')
  const showAllDay = isVisible(activityType, 'allDay')
  const showRecurrence = isVisible(activityType, 'recurrence')

  const dateMissing = !date.trim()
  const timeMissing = showStartTime && !allDay && !startTime.trim()
  const dateErrorId = 'schedule-date-error'
  const timeErrorId = 'schedule-time-error'

  return (
    <>
      {/* Date / Time / Duration */}
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-0 flex-[1.5] flex-col gap-1.5">
          <label className="text-sm font-medium">
            {getFieldLabel(activityType, 'date', t, 'customers.schedule.date', 'Date')}
            <span className="text-accent-indigo"> *</span>
          </label>
          <DatePicker
            value={parseIsoDate(date)}
            onChange={(next) => setDate(formatIsoDate(next))}
            placeholder={t('customers.schedule.date.placeholder', 'Pick a date')}
            required
            aria-describedby={dateMissing ? dateErrorId : undefined}
            className={cn(
              'h-10',
              dateMissing && 'border-status-error-border',
            )}
          />
          {dateMissing ? (
            <p id={dateErrorId} className="text-xs text-status-error-foreground">
              {t('customers.activities.errors.dateRequired', 'Date is required')}
            </p>
          ) : null}
        </div>
        {showStartTime && (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label className="text-sm font-medium">
              {getFieldLabel(activityType, 'startTime', t, 'customers.schedule.start', 'Start')}
              <span className="text-accent-indigo"> *</span>
            </label>
            <TimePicker
              value={startTime || null}
              onChange={(next) => setStartTime(next ?? '')}
              disabled={allDay}
              placeholder={t('customers.schedule.start.placeholder', 'Pick a time')}
              className={cn(
                'py-2.5',
                timeMissing ? 'border-status-error-border' : undefined,
              )}
              showNowButton
              showClearButton={false}
              popoverModal
            />
            {timeMissing ? (
              <p id={timeErrorId} className="text-xs text-status-error-foreground">
                {t('customers.activities.errors.timeRequired', 'Time is required')}
              </p>
            ) : null}
          </div>
        )}
        {showDuration && (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label className="text-sm font-medium">
              {getFieldLabel(activityType, 'duration', t, 'customers.schedule.duration', 'Duration')}
            </label>
            <Select
              value={String(duration)}
              onValueChange={(next) => {
                const parsed = Number(next)
                if (Number.isFinite(parsed)) setDuration(parsed)
              }}
              disabled={allDay}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder={t('customers.schedule.duration.placeholder', 'Pick duration')} />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {t(option.key, option.fallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* All day + timezone + recurrence */}
      {showAllDay && (
        <div className="flex flex-wrap items-center gap-3.5 text-xs text-muted-foreground">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={allDay} onCheckedChange={(checked) => setAllDay(checked === true)} />
            {t('customers.schedule.allDay', 'All day')}
          </label>
          <span className="flex items-center gap-1.5">
            <Globe className="size-3.5" />
            {Intl.DateTimeFormat().resolvedOptions().timeZone} (GMT{new Date().getTimezoneOffset() <= 0 ? '+' : '-'}{String(Math.abs(Math.floor(new Date().getTimezoneOffset() / 60))).padStart(1, '0')})
          </span>
          {showRecurrence && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRecurrenceEnabled(!recurrenceEnabled)}
                className={cn('h-auto flex items-center gap-1.5', recurrenceEnabled && 'font-medium text-foreground')}
              >
                <Repeat className="size-3.5" />
                {recurrenceEnabled
                  ? t('customers.schedule.recurrence.active', 'Repeats')
                  : t('customers.schedule.recurrence.none', 'No repeat')}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Recurrence config */}
      {showRecurrence && recurrenceEnabled && (
        <div className="rounded-lg border border-brand-violet/30 bg-brand-violet/10 p-4 space-y-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Repeat className="size-3.5" />
            {t('customers.schedule.recurrence.title', 'Recurrence')}
          </span>
          <div className="flex gap-2">
            {RECURRENCE_DAY_KEYS.map(([key, fallback], i) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={recurrenceDays[i]}
                onClick={() => toggleRecurrenceDay(i)}
                className={cn(
                  'h-auto flex size-8 items-center justify-center rounded-md text-xs font-medium transition-colors p-0',
                  recurrenceDays[i] ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-muted-foreground hover:bg-brand-violet/20 dark:hover:bg-brand-violet/20',
                )}
              >
                {t(key, fallback).slice(0, 2)}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t('customers.schedule.recurrence.ends', 'Ends')}:</span>
            {([
              ['never', t('customers.schedule.recurrence.never', 'Never')],
              ['count', t('customers.schedule.recurrence.afterOccurrences', 'After occurrences')],
              ['date', t('customers.schedule.recurrence.onDate', 'On date')],
            ] as const).map(([type, label]) => (
              <Button
                key={type}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={recurrenceEndType === type}
                onClick={() => setRecurrenceEndType(type)}
                className={cn(
                  'h-8 rounded-md px-2.5 text-xs font-medium',
                  recurrenceEndType === type
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-muted-foreground hover:bg-brand-violet/20 dark:hover:bg-brand-violet/20',
                )}
              >
                {label}
              </Button>
            ))}
            {recurrenceEndType === 'count' ? (
              <Input
                type="number"
                size="sm"
                min={1}
                value={recurrenceCount}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10)
                  setRecurrenceCount(Number.isFinite(parsed) && parsed > 0 ? parsed : 1)
                }}
                aria-label={t('customers.schedule.recurrence.afterOccurrences', 'After occurrences')}
                className="h-8 w-20"
              />
            ) : null}
            {recurrenceEndType === 'date' ? (
              <DatePicker
                value={parseIsoDate(recurrenceEndDate)}
                onChange={(next) => setRecurrenceEndDate(formatIsoDate(next))}
                placeholder={t('customers.schedule.recurrence.onDate', 'On date')}
                aria-label={t('customers.schedule.recurrence.onDate', 'On date')}
                className="h-8 w-40 text-xs"
              />
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
