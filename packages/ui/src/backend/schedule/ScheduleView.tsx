"use client"

import * as React from 'react'
import type { ScheduleItem, ScheduleRange, ScheduleSlot, ScheduleViewMode } from './types'
import { ScheduleToolbar } from './ScheduleToolbar'
import { ScheduleGrid } from './ScheduleGrid'
import { ScheduleAgenda } from './ScheduleAgenda'

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
  return (
    <div className={className}>
      <ScheduleToolbar
        view={view}
        range={range}
        timezone={timezone}
        onRangeChange={onRangeChange}
        onViewChange={onViewChange}
        onTimezoneChange={onTimezoneChange}
      />
      <div className="mt-4">
        {view === 'agenda' ? (
          <ScheduleAgenda
            items={items}
            range={range}
            timezone={timezone}
            onItemClick={onItemClick}
            onSlotClick={onSlotClick}
          />
        ) : (
          <ScheduleGrid
            items={items}
            range={range}
            timezone={timezone}
            onItemClick={onItemClick}
            onSlotClick={onSlotClick}
          />
        )}
      </div>
    </div>
  )
}
