'use client'

import * as React from 'react'
import { Globe, Repeat } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
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
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

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
          <label className="text-overline font-semibold text-muted-foreground tracking-wider">
            {getFieldLabel(activityType, 'date', t, 'customers.schedule.date', 'Date')}
            <span aria-hidden="true" className="ml-1 text-status-error-foreground">*</span>
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
            <label className="text-overline font-semibold text-muted-foreground tracking-wider">
              {getFieldLabel(activityType, 'startTime', t, 'customers.schedule.start', 'Start')}
              <span aria-hidden="true" className="ml-1 text-status-error-foreground">*</span>
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
          <span className="text-muted-foreground">&middot;</span>
          <span className="flex items-center gap-1.5">
            <Globe className="size-3.5" />
            {Intl.DateTimeFormat().resolvedOptions().timeZone} (GMT{new Date().getTimezoneOffset() <= 0 ? '+' : '-'}{String(Math.abs(Math.floor(new Date().getTimezoneOffset() / 60))).padStart(1, '0')})
          </span>
          {showRecurrence && (
            <>
              <span className="text-muted-foreground">&middot;</span>
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
        <div className="rounded-lg border border-status-warning-border bg-status-warning-bg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Repeat className="size-3.5" />
              {t('customers.schedule.recurrence.title', 'Recurrence')}
            </span>
            <Button type="button" variant="ghost" size="sm" className="h-auto text-xs font-medium text-foreground">
              {t('customers.schedule.recurrence.edit', 'Edit')}
            </Button>
          </div>
          <div className="flex gap-2">
            {DAYS_OF_WEEK.map((day, i) => (
              <Button
                key={day}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => toggleRecurrenceDay(i)}
                className={cn(
                  'h-auto flex size-8 items-center justify-center rounded-full text-xs font-medium transition-colors p-0',
                  recurrenceDays[i] ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {day.slice(0, 2)}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t('customers.schedule.recurrence.ends', 'Ends')}:</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRecurrenceEndType('never')} className={cn('h-auto rounded-full px-3 py-1 text-xs font-medium', recurrenceEndType === 'never' ? 'bg-background border border-border text-foreground' : 'text-muted-foreground')}>
              {t('customers.schedule.recurrence.never', 'Never')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRecurrenceEndType('count')} className={cn('h-auto rounded-full px-3 py-1 text-xs font-medium', recurrenceEndType === 'count' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
              {t('customers.schedule.recurrence.afterCount', 'After {{count}} occurrences', { count: recurrenceCount })}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRecurrenceEndType('date')} className={cn('h-auto rounded-full px-3 py-1 text-xs font-medium', recurrenceEndType === 'date' ? 'bg-background border border-border text-foreground' : 'text-muted-foreground')}>
              {recurrenceEndDate || t('customers.schedule.recurrence.onDate', 'On date')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
