'use client'

import * as React from 'react'
import { Calendar, Clock, ChevronDown, Globe, Repeat } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible, getFieldLabel } from './fieldConfig'

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]
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

  return (
    <>
      {/* Date / Time / Duration */}
      <div className="flex gap-3">
        <div className="flex flex-[2] flex-col gap-1.5">
          <label className="text-overline font-semibold text-muted-foreground tracking-wider">
            {getFieldLabel(activityType, 'date', t, 'customers.schedule.date', 'Date')}
          </label>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
            <Calendar className="size-3.5 text-muted-foreground" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 bg-transparent text-sm text-foreground focus:outline-none" />
          </div>
        </div>
        {showStartTime && (
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-overline font-semibold text-muted-foreground tracking-wider">
              {getFieldLabel(activityType, 'startTime', t, 'customers.schedule.start', 'Start')}
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
              <Clock className="size-3.5 text-muted-foreground" />
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={allDay} className="flex-1 bg-transparent text-sm text-foreground focus:outline-none disabled:opacity-50" />
            </div>
          </div>
        )}
        {showDuration && (
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-overline font-semibold text-muted-foreground tracking-wider">
              {getFieldLabel(activityType, 'duration', t, 'customers.schedule.duration', 'Duration')}
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={allDay}
                className="flex-1 appearance-none bg-transparent text-sm text-foreground focus:outline-none disabled:opacity-50"
              >
                {DURATION_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </div>
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
