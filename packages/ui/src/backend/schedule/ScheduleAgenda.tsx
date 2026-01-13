"use client"

import * as React from 'react'
import type { ScheduleItem, ScheduleRange, ScheduleSlot } from './types'
import { cn } from '@/lib/utils'
import { Badge } from '../../primitives/badge'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { expandRecurringItems } from './recurrence'

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999)
}

function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = []
  let cursor = startOfDay(start)
  const last = startOfDay(end)
  while (cursor <= last) {
    days.push(new Date(cursor))
    cursor = new Date(cursor.getTime() + DAY_MS)
  }
  return days
}

function overlapsDay(item: ScheduleItem, day: Date): boolean {
  const dayStart = startOfDay(day)
  const dayEnd = endOfDay(day)
  return item.startsAt <= dayEnd && item.endsAt >= dayStart
}

function formatDayLabel(day: Date): string {
  return day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatTimeRange(item: ScheduleItem, timezone?: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
  if (timezone) options.timeZone = timezone
  const startLabel = item.startsAt.toLocaleTimeString(undefined, options)
  const endLabel = item.endsAt.toLocaleTimeString(undefined, options)
  return `${startLabel}-${endLabel}`
}

function getStatusLabel(status: ScheduleItem['status'], t: (key: string, fallback?: string) => string): string | null {
  if (!status) return null
  if (status === 'draft') return t('schedule.item.status.draft', 'Draft')
  if (status === 'negotiation') return t('schedule.item.status.negotiation', 'Negotiation')
  if (status === 'confirmed') return t('schedule.item.status.confirmed', 'Confirmed')
  if (status === 'cancelled') return t('schedule.item.status.cancelled', 'Cancelled')
  return null
}

function getKindStyles(kind: ScheduleItem['kind']): string {
  if (kind === 'event') return 'border-blue-500/40 bg-blue-500/10 text-blue-950'
  if (kind === 'exception') return 'border-amber-500/40 bg-amber-500/10 text-amber-950'
  return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-950'
}

export type ScheduleAgendaProps = {
  items: ScheduleItem[]
  range: ScheduleRange
  timezone?: string
  onItemClick?: (item: ScheduleItem) => void
  onSlotClick?: (slot: ScheduleSlot) => void
  className?: string
}

export function ScheduleAgenda({ items, range, timezone, onItemClick, onSlotClick, className }: ScheduleAgendaProps) {
  const t = useT()
  const days = React.useMemo(() => eachDay(range.start, range.end), [range])
  const expandedItems = React.useMemo(() => expandRecurringItems(items, range), [items, range])

  return (
    <div className={cn('space-y-4', className)}>
      {days.map((day) => {
        const dayItems = expandedItems.filter((item) => overlapsDay(item, day))
        const slotStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0)
        const slotEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 0, 0)
        return (
          <div key={day.toISOString()} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-foreground">{formatDayLabel(day)}</div>
              {onSlotClick ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onSlotClick({ start: slotStart, end: slotEnd })}
                >
                  {t('schedule.actions.add', 'Add')}
                </Button>
              ) : null}
            </div>
            <div className="mt-3 space-y-2">
              {dayItems.length === 0 ? (
                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  {t('schedule.emptyDay', 'No scheduled items')}
                </div>
              ) : (
                dayItems.map((item) => {
                  const statusLabel = getStatusLabel(item.status, t)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        'flex w-full flex-col gap-2 rounded-lg border px-3 py-2 text-left text-xs transition hover:shadow-sm',
                        getKindStyles(item.kind)
                      )}
                      onClick={() => onItemClick?.(item)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{item.title}</span>
                        {statusLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{formatTimeRange(item, timezone)}</span>
                        <span className="capitalize">{item.kind}</span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
