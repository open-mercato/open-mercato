"use client"

import * as React from 'react'
import { Clock, LayoutGrid, List } from 'lucide-react'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarTab, CalendarTabsProps, CalendarView } from './types'

function TabCount({ value }: { value: number }) {
  return <span className="text-xs font-medium text-muted-foreground">({value})</span>
}

export function CalendarTabs({ tab, counts, view, onTabChange, onViewChange }: CalendarTabsProps) {
  const t = useT()

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as CalendarTab)}
      variant="underline"
    >
      <div className="flex flex-wrap items-stretch justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 max-w-full overflow-x-auto scrollbar-hide [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] sm:[mask-image:none]">
          <TabsList className="shrink-0">
            <TabsTrigger value="all" leading={<LayoutGrid className="size-4" />}>
              {t('customers.calendar.tabs.all', 'All Scheduled')}
            </TabsTrigger>
            <TabsTrigger value="meetings" leading={<List className="size-4" />}>
              {t('customers.calendar.tabs.meetings', 'Meetings')} <TabCount value={counts.meetings} />
            </TabsTrigger>
            <TabsTrigger value="events" leading={<Clock className="size-4" />}>
              {t('customers.calendar.tabs.events', 'Events')} <TabCount value={counts.events} />
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end border-b border-input">
          <SegmentedControl
            value={view}
            onValueChange={(value) => onViewChange(value as CalendarView)}
            aria-label={t('customers.calendar.views.label', 'Calendar view')}
          >
            <SegmentedControlItem value="day">
              {t('customers.calendar.views.day', 'Day')}
            </SegmentedControlItem>
            <SegmentedControlItem value="week">
              {t('customers.calendar.views.week', 'Week')}
            </SegmentedControlItem>
            <SegmentedControlItem value="month">
              {t('customers.calendar.views.month', 'Month')}
            </SegmentedControlItem>
            <SegmentedControlItem value="agenda">
              {t('customers.calendar.views.agenda', 'Agenda')}
            </SegmentedControlItem>
          </SegmentedControl>
        </div>
      </div>
    </Tabs>
  )
}
