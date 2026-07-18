import * as React from 'react'
import {
  ScheduleAgenda,
  ScheduleGrid,
  ScheduleToolbar,
  ScheduleView,
  type ScheduleItem,
  type ScheduleRange,
  type ScheduleViewMode,
} from '@open-mercato/ui/backend/schedule'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// Fixed sample dates (June 2026) — previews must not depend on "today" so the
// gallery renders identically on any day.
const weekRange: ScheduleRange = {
  start: new Date(2026, 5, 7),
  end: new Date(2026, 5, 13, 23, 59, 59, 999),
}
const monthRange: ScheduleRange = {
  start: new Date(2026, 5, 1),
  end: new Date(2026, 5, 30, 23, 59, 59, 999),
}
const boardRange: ScheduleRange = {
  start: new Date(2026, 5, 8),
  end: new Date(2026, 5, 10, 23, 59, 59, 999),
}
const emptyDayRange: ScheduleRange = {
  start: new Date(2026, 5, 11),
  end: new Date(2026, 5, 11, 23, 59, 59, 999),
}
const agendaRange: ScheduleRange = {
  start: new Date(2026, 5, 8),
  end: new Date(2026, 5, 9, 23, 59, 59, 999),
}
const draftDayRange: ScheduleRange = {
  start: new Date(2026, 5, 12),
  end: new Date(2026, 5, 12, 23, 59, 59, 999),
}

const sampleItems: ScheduleItem[] = [
  {
    id: 'availability-1',
    kind: 'availability',
    title: 'Open studio hours',
    startsAt: new Date(2026, 5, 8, 9, 0),
    endsAt: new Date(2026, 5, 8, 12, 0),
    status: 'confirmed',
    subjectType: 'member',
    subjectId: 'member-1',
  },
  {
    id: 'event-1',
    kind: 'event',
    title: 'Fitting — Anna Nowak',
    startsAt: new Date(2026, 5, 8, 13, 0),
    endsAt: new Date(2026, 5, 8, 14, 0),
    status: 'negotiation',
  },
  {
    id: 'event-2',
    kind: 'event',
    title: 'Delivery walkthrough',
    startsAt: new Date(2026, 5, 9, 10, 0),
    endsAt: new Date(2026, 5, 9, 11, 30),
    status: 'confirmed',
  },
  {
    id: 'exception-1',
    kind: 'exception',
    title: 'Studio closed',
    startsAt: new Date(2026, 5, 10, 0, 0),
    endsAt: new Date(2026, 5, 10, 23, 59),
    status: 'cancelled',
  },
  {
    id: 'event-3',
    kind: 'event',
    title: 'Quarterly review',
    startsAt: new Date(2026, 5, 12, 15, 0),
    endsAt: new Date(2026, 5, 12, 16, 0),
    status: 'draft',
  },
]

function initialRangeFor(view: ScheduleViewMode): ScheduleRange {
  return view === 'month' ? monthRange : weekRange
}

function DemoScheduleView({ initialView }: { initialView: ScheduleViewMode }) {
  const [view, setView] = React.useState<ScheduleViewMode>(initialView)
  const [range, setRange] = React.useState<ScheduleRange>(initialRangeFor(initialView))
  const [timezone, setTimezone] = React.useState('Europe/Warsaw')
  return (
    <ScheduleView
      items={sampleItems}
      view={view}
      range={range}
      timezone={timezone}
      onViewChange={setView}
      onRangeChange={setRange}
      onTimezoneChange={setTimezone}
      className="w-full"
    />
  )
}

function DemoScheduleToolbar({ initialView }: { initialView: ScheduleViewMode }) {
  const [view, setView] = React.useState<ScheduleViewMode>(initialView)
  const [range, setRange] = React.useState<ScheduleRange>(initialRangeFor(initialView))
  const [timezone, setTimezone] = React.useState('Europe/Warsaw')
  return (
    <ScheduleToolbar
      view={view}
      range={range}
      timezone={timezone}
      onViewChange={setView}
      onRangeChange={setRange}
      onTimezoneChange={setTimezone}
      className="w-full"
    />
  )
}

const scheduleViewEntry: GalleryEntry = {
  id: 'schedule-view',
  title: 'ScheduleView',
  importPath: '@open-mercato/ui/backend/schedule',
  variants: [
    {
      id: 'week',
      title: 'Week (controlled)',
      render: () => <DemoScheduleView initialView="week" />,
      code: `import { ScheduleView, type ScheduleItem, type ScheduleRange, type ScheduleViewMode } from '@open-mercato/ui/backend/schedule'

const [view, setView] = React.useState<ScheduleViewMode>('week')
const [range, setRange] = React.useState<ScheduleRange>({
  start: new Date(2026, 5, 7),
  end: new Date(2026, 5, 13, 23, 59, 59, 999),
})

<ScheduleView
  items={items /* ScheduleItem[] mapped from your domain records */}
  view={view}
  range={range}
  timezone="Europe/Warsaw"
  onViewChange={setView}
  onRangeChange={setRange}
/>`,
    },
    {
      id: 'month',
      title: 'Month (controlled)',
      render: () => <DemoScheduleView initialView="month" />,
      code: `import { ScheduleView, type ScheduleRange, type ScheduleViewMode } from '@open-mercato/ui/backend/schedule'

const [view, setView] = React.useState<ScheduleViewMode>('month')
const [range, setRange] = React.useState<ScheduleRange>({
  start: new Date(2026, 5, 1),
  end: new Date(2026, 5, 30, 23, 59, 59, 999),
})

<ScheduleView items={items} view={view} range={range} onViewChange={setView} onRangeChange={setRange} />`,
    },
  ],
}

const scheduleToolbarEntry: GalleryEntry = {
  id: 'schedule-toolbar',
  title: 'ScheduleToolbar',
  importPath: '@open-mercato/ui/backend/schedule',
  variants: [
    {
      id: 'week-with-timezone',
      title: 'Week range with timezone',
      render: () => <DemoScheduleToolbar initialView="week" />,
      code: `import { ScheduleToolbar, type ScheduleRange, type ScheduleViewMode } from '@open-mercato/ui/backend/schedule'

const [view, setView] = React.useState<ScheduleViewMode>('week')
const [range, setRange] = React.useState<ScheduleRange>({
  start: new Date(2026, 5, 7),
  end: new Date(2026, 5, 13, 23, 59, 59, 999),
})
const [timezone, setTimezone] = React.useState('Europe/Warsaw')

<ScheduleToolbar
  view={view}
  range={range}
  timezone={timezone}
  onViewChange={setView}
  onRangeChange={setRange}
  onTimezoneChange={setTimezone}
/>`,
    },
    {
      id: 'month-range',
      title: 'Month range',
      render: () => <DemoScheduleToolbar initialView="month" />,
      code: `import { ScheduleToolbar, type ScheduleRange, type ScheduleViewMode } from '@open-mercato/ui/backend/schedule'

const [view, setView] = React.useState<ScheduleViewMode>('month')
const [range, setRange] = React.useState<ScheduleRange>({
  start: new Date(2026, 5, 1),
  end: new Date(2026, 5, 30, 23, 59, 59, 999),
})

<ScheduleToolbar view={view} range={range} onViewChange={setView} onRangeChange={setRange} />`,
    },
  ],
}

const scheduleGridEntry: GalleryEntry = {
  id: 'schedule-grid',
  title: 'ScheduleGrid',
  importPath: '@open-mercato/ui/backend/schedule',
  variants: [
    {
      id: 'three-day-board',
      title: 'Three-day board',
      render: () => (
        <ScheduleGrid
          items={sampleItems}
          range={boardRange}
          timezone="Europe/Warsaw"
          onItemClick={() => {}}
          onSlotClick={() => {}}
          className="w-full"
        />
      ),
      code: `import { ScheduleGrid, type ScheduleItem } from '@open-mercato/ui/backend/schedule'

<ScheduleGrid
  items={items /* ScheduleItem[] */}
  range={{ start: new Date(2026, 5, 8), end: new Date(2026, 5, 10, 23, 59, 59, 999) }}
  timezone="Europe/Warsaw"
  onItemClick={(item) => openItem(item)}
  onSlotClick={(slot) => createDraft(slot)}
/>`,
    },
    {
      id: 'read-only-empty',
      title: 'Read-only empty day',
      render: () => <ScheduleGrid items={[]} range={emptyDayRange} className="w-full" />,
      code: `import { ScheduleGrid } from '@open-mercato/ui/backend/schedule'

<ScheduleGrid
  items={[]}
  range={{ start: new Date(2026, 5, 11), end: new Date(2026, 5, 11, 23, 59, 59, 999) }}
/>`,
    },
  ],
}

const scheduleAgendaEntry: GalleryEntry = {
  id: 'schedule-agenda',
  title: 'ScheduleAgenda',
  importPath: '@open-mercato/ui/backend/schedule',
  variants: [
    {
      id: 'two-days',
      title: 'Two days with statuses',
      render: () => (
        <ScheduleAgenda
          items={sampleItems}
          range={agendaRange}
          timezone="Europe/Warsaw"
          onItemClick={() => {}}
          onSlotClick={() => {}}
          className="w-full"
        />
      ),
      code: `import { ScheduleAgenda, type ScheduleItem } from '@open-mercato/ui/backend/schedule'

<ScheduleAgenda
  items={items /* ScheduleItem[] */}
  range={{ start: new Date(2026, 5, 8), end: new Date(2026, 5, 9, 23, 59, 59, 999) }}
  timezone="Europe/Warsaw"
  onItemClick={(item) => openItem(item)}
  onSlotClick={(slot) => createDraft(slot)}
/>`,
    },
    {
      id: 'read-only-day',
      title: 'Read-only day (draft item)',
      render: () => (
        <ScheduleAgenda items={sampleItems} range={draftDayRange} className="w-full" />
      ),
      code: `import { ScheduleAgenda } from '@open-mercato/ui/backend/schedule'

<ScheduleAgenda
  items={items}
  range={{ start: new Date(2026, 5, 12), end: new Date(2026, 5, 12, 23, 59, 59, 999) }}
/>`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  scheduleViewEntry,
  scheduleToolbarEntry,
  scheduleGridEntry,
  scheduleAgendaEntry,
]
