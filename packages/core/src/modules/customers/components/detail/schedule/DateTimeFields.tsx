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
      <div className="flex gap-[12px]">
        <div className="flex flex-[2] flex-col gap-[6px]">
          <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">
            {getFieldLabel(activityType, 'date', t, 'customers.schedule.date', 'Date')}
          </label>
          <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-background px-[12px] py-[10px]">
            <Calendar className="size-[14px] text-muted-foreground" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 bg-transparent text-[13px] text-foreground focus:outline-none" />
          </div>
        </div>
        {showStartTime && (
          <div className="flex flex-1 flex-col gap-[6px]">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">{t('customers.schedule.start', 'Start')}</label>
            <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-background px-[12px] py-[10px]">
              <Clock className="size-[14px] text-muted-foreground" />
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={allDay} className="flex-1 bg-transparent text-[13px] text-foreground focus:outline-none disabled:opacity-50" />
            </div>
          </div>
        )}
        {showDuration && (
          <div className="flex flex-1 flex-col gap-[6px]">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">{t('customers.schedule.duration', 'Duration')}</label>
            <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-background px-[12px] py-[10px]">
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={allDay}
                className="flex-1 appearance-none bg-transparent text-[13px] text-foreground focus:outline-none disabled:opacity-50"
              >
                {DURATION_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
              <ChevronDown className="size-[14px] text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* All day + timezone + recurrence */}
      {showAllDay && (
        <div className="flex flex-wrap items-center gap-[14px] text-[12px] text-muted-foreground">
          <label className="flex items-center gap-[8px] cursor-pointer">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="rounded" />
            {t('customers.schedule.allDay', 'All day')}
          </label>
          <span className="text-muted-foreground">&middot;</span>
          <span className="flex items-center gap-[6px]">
            <Globe className="size-[14px]" />
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
                className={cn('h-auto flex items-center gap-[6px]', recurrenceEnabled && 'font-medium text-foreground')}
              >
                <Repeat className="size-[14px]" />
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
        <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-[16px] space-y-[12px] dark:border-amber-700 dark:bg-amber-950">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-[8px] text-[13px] font-semibold text-foreground">
              <Repeat className="size-[14px]" />
              {t('customers.schedule.recurrence.title', 'Recurrence')}
            </span>
            <Button type="button" variant="ghost" size="sm" className="h-auto text-[12px] font-medium text-foreground">
              {t('customers.schedule.recurrence.edit', 'Edit')}
            </Button>
          </div>
          <div className="flex gap-[8px]">
            {DAYS_OF_WEEK.map((day, i) => (
              <Button
                key={day}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => toggleRecurrenceDay(i)}
                className={cn(
                  'h-auto flex size-[32px] items-center justify-center rounded-full text-[11px] font-medium transition-colors p-0',
                  recurrenceDays[i] ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {day.slice(0, 2)}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-[8px] text-[12px] text-muted-foreground">
            <span>{t('customers.schedule.recurrence.ends', 'Ends')}:</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRecurrenceEndType('never')} className={cn('h-auto rounded-full px-[12px] py-[4px] text-[11px] font-medium', recurrenceEndType === 'never' ? 'bg-background border border-border text-foreground' : 'text-muted-foreground')}>
              {t('customers.schedule.recurrence.never', 'Never')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRecurrenceEndType('count')} className={cn('h-auto rounded-full px-[12px] py-[4px] text-[11px] font-medium', recurrenceEndType === 'count' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
              {t('customers.schedule.recurrence.afterCount', 'After {{count}} occurrences', { count: recurrenceCount })}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRecurrenceEndType('date')} className={cn('h-auto rounded-full px-[12px] py-[4px] text-[11px] font-medium', recurrenceEndType === 'date' ? 'bg-background border border-border text-foreground' : 'text-muted-foreground')}>
              {recurrenceEndDate || t('customers.schedule.recurrence.onDate', 'On date')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
