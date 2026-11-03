"use client"

import * as React from 'react'
import { CalendarDays, LayoutGrid, List } from 'lucide-react'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TimesheetView } from './useTimesheetPreferences'

/**
 * The three-way switch of T5.5 — `Kalendarz · Lista · Siatka`.
 *
 * The mockups draw two views; the third is the editable project × day grid the
 * module already had, which the spec keeps because it is the fastest way to fill
 * a week. All three are peers here rather than the grid being a mode of the
 * list: they answer three different questions ("where are my gaps this month",
 * "close out this week day by day", "type a week of hours in one pass").
 */

const VIEW_ICONS: Record<TimesheetView, React.ComponentType<{ className?: string }>> = {
  calendar: CalendarDays,
  list: List,
  grid: LayoutGrid,
}

const ALL_VIEWS: readonly TimesheetView[] = ['calendar', 'list', 'grid']

export function TimesheetViewSwitch({
  view,
  onViewChange,
  views = ALL_VIEWS,
}: {
  view: TimesheetView
  onViewChange: (next: TimesheetView) => void
  /**
   * Which views this period supports. A quarter or a year has no editable grid —
   * ninety day columns is not a bulk-entry surface — so the option is **absent**
   * rather than rendered disabled, the same rule the module applies to actions a
   * caller may not take.
   */
  views?: readonly TimesheetView[]
}) {
  const t = useT()
  const labels: Record<TimesheetView, string> = {
    calendar: t('staff.time_tracking.timesheet.view.calendar', 'Calendar'),
    list: t('staff.time_tracking.timesheet.view.list', 'List'),
    grid: t('staff.time_tracking.timesheet.view.grid', 'Grid'),
  }
  return (
    <SegmentedControl
      value={view}
      onValueChange={(value) => {
        if (value !== view) onViewChange(value as TimesheetView)
      }}
      aria-label={t('staff.time_tracking.timesheet.view.label', 'Timesheet view')}
      className="shrink-0"
    >
      {views.map((id) => {
        const Icon = VIEW_ICONS[id]
        return (
          <SegmentedControlItem key={id} value={id}>
            <span className="flex items-center gap-1.5">
              <Icon className="size-3.5" aria-hidden="true" />
              {labels[id]}
            </span>
          </SegmentedControlItem>
        )
      })}
    </SegmentedControl>
  )
}
