"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import type { ScheduleItem, ScheduleRange, ScheduleSlot, ScheduleViewMode } from './types'
import { ScheduleToolbar } from './ScheduleToolbar'
import type { ScheduleCalendarProps } from './ScheduleCalendar'

const ScheduleCalendar = dynamic<ScheduleCalendarProps>(
  () => import('./ScheduleCalendar'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[640px] items-center justify-center text-sm text-muted-foreground">
        Loading calendar…
      </div>
    ),
  },
)

export type ScheduleViewProps = {
  items: ScheduleItem[]
  view: ScheduleViewMode
  range: ScheduleRange
  timezone?: string
  onRangeChange: (range: ScheduleRange) => void
  onViewChange: (view: ScheduleViewMode) => void
  onItemClick?: (item: ScheduleItem) => void
  onSlotClick?: (slot: ScheduleSlot) => void
  onTimezoneChange?: (timezone: string) => void
  className?: string
}

export function ScheduleView({
  items,
  view,
  range,
  timezone,
  onRangeChange,
  onViewChange,
  onItemClick,
  onSlotClick,
  onTimezoneChange,
  className,
}: ScheduleViewProps) {
  const rootClassName = ['schedule-view', className].filter(Boolean).join(' ')

  return (
    <div className={rootClassName}>
      <ScheduleToolbar
        view={view}
        range={range}
        timezone={timezone}
        onRangeChange={onRangeChange}
        onViewChange={onViewChange}
        onTimezoneChange={onTimezoneChange}
      />
      <div className="schedule-calendar mt-4 rounded-xl border bg-card p-3">
        <ScheduleCalendar
          items={items}
          view={view}
          range={range}
          onRangeChange={onRangeChange}
          onViewChange={onViewChange}
          onItemClick={onItemClick}
          onSlotClick={onSlotClick}
        />
      </div>
    </div>
  )
}
