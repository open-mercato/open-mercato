'use client'

import * as React from 'react'
import { Globe, Repeat } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { Input } from '@open-mercato/ui/primitives/input'
import { TimePicker } from '@open-mercato/ui/backend/inputs/TimePicker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isDateRequired, isTimeRequired, getFieldLabel } from './fieldConfig'
import { USER_TIMEZONE } from '../../../lib/localDay'

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

  const showStartTime = visible.has('startTime')
  const showDuration = visible.has('duration')
  const showAllDay = visible.has('allDay')
  const showRecurrence = visible.has('recurrence')

  const dateRequired = isDateRequired(activityType)
  const timeRequired = isTimeRequired(activityType)
  const dateMissing = dateRequired && !date.trim()
  const timeMissing = timeRequired && showStartTime && !allDay && !startTime.trim()
  const dateErrorId = 'schedule-date-error'
  const timeErrorId = 'schedule-time-error'

  return (
    <>
      {/* Date / Time / Duration */}
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-0 flex-[1.5] flex-col gap-1.5">
          <label className="text-overline font-semibold text-muted-foreground tracking-wider">
            {getFieldLabel(activityType, 'date', t, 'customers.schedule.date', 'Date')}
            {dateRequired ? (
              <span aria-hidden="true" className="ml-1 text-status-error-foreground">*</span>
            ) : null}
          </label>
          <DatePicker
            value={parseIsoDate(date)}
            onChange={(next) => setDate(formatIsoDate(next))}
            placeholder={t('customers.schedule.date.placeholder', 'Pick a date')}
            required={dateRequired}
            // An optional date seeds to today, so the picker needs a way back to
            // "no due date"; the default apply/cancel footer cannot reach null.
            footer={dateRequired ? undefined : 'today-clear'}
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
            <label className="text-overline font-semibold text-muted-foreground tracking-wider">
              {getFieldLabel(activityType, 'startTime', t, 'customers.schedule.start', 'Start')}
              {timeRequired ? (
                <span aria-hidden="true" className="ml-1 text-status-error-foreground">*</span>
              ) : null}
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
              popoverModal
              showClearButton={!timeRequired}
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
            <label className="text-overline font-semibold text-muted-foreground tracking-wider">
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
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="rounded" />
            {t('customers.schedule.allDay', 'All day')}
          </label>
          <span className="flex items-center gap-1.5">
            <Globe className="size-3.5" />
            {USER_TIMEZONE} (GMT{new Date().getTimezoneOffset() <= 0 ? '+' : '-'}{String(Math.abs(Math.floor(new Date().getTimezoneOffset() / 60))).padStart(1, '0')})
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
        <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Repeat className="size-3.5" />
            {t('customers.schedule.recurrence.title', 'Recurrence')}
          </span>
          <div className="flex flex-wrap gap-2">
            {RECURRENCE_DAY_KEYS.map(([key, fallback], index) => (
              <Button
                key={key}
                type="button"
                variant={recurrenceDays[index] ? 'default' : 'ghost'}
                size="sm"
                aria-pressed={recurrenceDays[index]}
                onClick={() => toggleRecurrenceDay(index)}
                className={cn(
                  'h-auto flex size-8 items-center justify-center rounded-full text-xs font-medium transition-colors p-0',
                  !recurrenceDays[index] && 'border border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {t(key, fallback).slice(0, 2)}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t('customers.schedule.recurrence.ends', 'Ends')}:</span>
            {([
              ['never', t('customers.schedule.recurrence.never', 'Never')],
              ['count', t('customers.schedule.recurrence.afterOccurrences', 'After occurrences')],
              ['date', t('customers.schedule.recurrence.onDate', 'On date')],
            ] as const).map(([endType, label]) => (
              <Button
                key={endType}
                type="button"
                variant={recurrenceEndType === endType ? 'default' : 'ghost'}
                size="sm"
                aria-pressed={recurrenceEndType === endType}
                onClick={() => setRecurrenceEndType(endType)}
                className={cn(
                  'h-auto rounded-full px-3 py-1 text-xs font-medium',
                  recurrenceEndType !== endType && 'border border-border bg-background text-muted-foreground hover:bg-muted',
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
                onChange={(event) => {
                  const parsed = parseInt(event.target.value, 10)
                  setRecurrenceCount(Number.isFinite(parsed) && parsed > 0 ? parsed : 1)
                }}
                aria-label={t('customers.schedule.recurrence.afterOccurrences', 'After occurrences')}
                className="w-20"
              />
            ) : null}
            {recurrenceEndType === 'date' ? (
              <DatePicker
                value={parseIsoDate(recurrenceEndDate)}
                onChange={(next) => setRecurrenceEndDate(formatIsoDate(next))}
                placeholder={t('customers.schedule.recurrence.onDate', 'On date')}
                aria-label={t('customers.schedule.recurrence.onDate', 'On date')}
                size="sm"
                className="w-40"
              />
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
