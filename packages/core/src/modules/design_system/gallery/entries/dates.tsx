import * as React from 'react'
import { Clock } from 'lucide-react'
import { Calendar } from '@open-mercato/ui/primitives/calendar'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { DateRangePicker } from '@open-mercato/ui/primitives/date-range-picker'
import {
  TimePicker,
  TimePickerSlot,
  TimePickerDurationChip,
  TimePickerStatusChip,
} from '@open-mercato/ui/primitives/time-picker'
import { Button } from '@open-mercato/ui/primitives/button'
import type { DateRange } from '@open-mercato/ui/backend/date-range'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// Fixed sample dates — previews must not depend on "today" so the gallery
// renders identically on any day (the `today` highlight ring aside).
const sampleDay = new Date(2026, 5, 12)
const sampleMonth = new Date(2026, 5, 1)
const sampleRange: DateRange = { start: new Date(2026, 5, 8), end: new Date(2026, 5, 19) }

function DemoCalendarSingle() {
  const [selected, setSelected] = React.useState<Date | undefined>(sampleDay)
  return (
    <Calendar
      mode="single"
      selected={selected}
      onSelect={(day) => setSelected(day)}
      defaultMonth={sampleMonth}
    />
  )
}

function DemoCalendarRange() {
  const [selected, setSelected] = React.useState<
    { from: Date | undefined; to?: Date | undefined } | undefined
  >({ from: sampleRange.start, to: sampleRange.end })
  return (
    <Calendar
      mode="range"
      selected={selected}
      onSelect={(range) => setSelected(range)}
      defaultMonth={sampleMonth}
    />
  )
}

const calendarEntry: GalleryEntry = {
  id: 'calendar',
  title: 'Calendar',
  importPath: '@open-mercato/ui/primitives/calendar',
  variants: [
    {
      id: 'single',
      title: 'Single selection',
      render: () => <DemoCalendarSingle />,
      code: `import { Calendar } from '@open-mercato/ui/primitives/calendar'

const [selected, setSelected] = React.useState<Date | undefined>()

<Calendar mode="single" selected={selected} onSelect={setSelected} />`,
    },
    {
      id: 'range',
      title: 'Range selection',
      render: () => <DemoCalendarRange />,
      code: `import { Calendar } from '@open-mercato/ui/primitives/calendar'

const [selected, setSelected] = React.useState<{ from?: Date; to?: Date }>()

<Calendar mode="range" selected={selected} onSelect={setSelected} />`,
    },
    {
      id: 'disabled-days',
      title: 'Disabled days',
      render: () => <Calendar defaultMonth={sampleMonth} disabled={{ dayOfWeek: [0, 6] }} />,
      code: `import { Calendar } from '@open-mercato/ui/primitives/calendar'

<Calendar disabled={{ dayOfWeek: [0, 6] }} />`,
    },
  ],
}

function DemoDatePicker() {
  const [value, setValue] = React.useState<Date | null>(sampleDay)
  return <DatePicker value={value} onChange={setValue} />
}

function DemoDatePickerWithTime() {
  const [value, setValue] = React.useState<Date | null>(new Date(2026, 5, 12, 9, 30))
  return <DatePicker value={value} onChange={setValue} withTime minuteStep={15} />
}

function DemoDatePickerTodayClear() {
  const [value, setValue] = React.useState<Date | null>(null)
  return <DatePicker value={value} onChange={setValue} footer="today-clear" />
}

const datePickerEntry: GalleryEntry = {
  id: 'date-picker',
  title: 'DatePicker',
  importPath: '@open-mercato/ui/primitives/date-picker',
  variants: [
    {
      id: 'default',
      title: 'default (apply-cancel footer)',
      render: () => <DemoDatePicker />,
      code: `import { DatePicker } from '@open-mercato/ui/primitives/date-picker'

const [value, setValue] = React.useState<Date | null>(null)

<DatePicker value={value} onChange={setValue} />`,
    },
    {
      id: 'with-time',
      title: 'withTime',
      render: () => <DemoDatePickerWithTime />,
      code: `import { DatePicker } from '@open-mercato/ui/primitives/date-picker'

const [value, setValue] = React.useState<Date | null>(null)

<DatePicker value={value} onChange={setValue} withTime minuteStep={15} />`,
    },
    {
      id: 'today-clear-footer',
      title: "footer='today-clear'",
      render: () => <DemoDatePickerTodayClear />,
      code: `import { DatePicker } from '@open-mercato/ui/primitives/date-picker'

const [value, setValue] = React.useState<Date | null>(null)

<DatePicker value={value} onChange={setValue} footer="today-clear" />`,
    },
    {
      id: 'states',
      title: 'Small / disabled',
      render: () => (
        <>
          <DatePicker value={sampleDay} onChange={() => {}} size="sm" />
          <DatePicker value={sampleDay} onChange={() => {}} disabled />
        </>
      ),
      code: `import { DatePicker } from '@open-mercato/ui/primitives/date-picker'

<DatePicker value={value} onChange={setValue} size="sm" />
<DatePicker value={value} onChange={setValue} disabled />`,
    },
  ],
}

function DemoDateRangePicker() {
  const [value, setValue] = React.useState<DateRange | null>(sampleRange)
  return <DateRangePicker value={value} onChange={setValue} />
}

function DemoDateRangePickerCompact() {
  const [value, setValue] = React.useState<DateRange | null>(null)
  return (
    <DateRangePicker
      value={value}
      onChange={setValue}
      showPresets={false}
      numberOfMonths={1}
      size="sm"
    />
  )
}

const dateRangePickerEntry: GalleryEntry = {
  id: 'date-range-picker',
  title: 'DateRangePicker',
  importPath: '@open-mercato/ui/primitives/date-range-picker',
  variants: [
    {
      id: 'default',
      title: 'default (presets + two months)',
      render: () => <DemoDateRangePicker />,
      code: `import { DateRangePicker } from '@open-mercato/ui/primitives/date-range-picker'
import type { DateRange } from '@open-mercato/ui/backend/date-range'

const [value, setValue] = React.useState<DateRange | null>(null)

<DateRangePicker value={value} onChange={setValue} />`,
    },
    {
      id: 'compact',
      title: 'Compact (no presets, one month)',
      render: () => <DemoDateRangePickerCompact />,
      code: `import { DateRangePicker } from '@open-mercato/ui/primitives/date-range-picker'

<DateRangePicker
  value={value}
  onChange={setValue}
  showPresets={false}
  numberOfMonths={1}
  size="sm"
/>`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => <DateRangePicker value={sampleRange} onChange={() => {}} disabled />,
      code: `import { DateRangePicker } from '@open-mercato/ui/primitives/date-range-picker'

<DateRangePicker value={value} onChange={setValue} disabled />`,
    },
  ],
}

const sampleSlots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']

function DemoTimePickerTrigger() {
  return (
    <TimePicker
      defaultValue="10:00"
      slots={sampleSlots}
      maxHeight={200}
      trigger={<Button variant="outline">Pick a time</Button>}
    />
  )
}

const timePickerEntry: GalleryEntry = {
  id: 'time-picker',
  title: 'TimePicker',
  importPath: '@open-mercato/ui/primitives/time-picker',
  variants: [
    {
      id: 'inline-card',
      title: 'Inline card',
      render: () => (
        <TimePicker defaultValue="10:00" slots={sampleSlots} maxHeight={160} />
      ),
      code: `import { TimePicker } from '@open-mercato/ui/primitives/time-picker'

<TimePicker
  defaultValue="10:00"
  slots={['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']}
/>`,
    },
    {
      id: 'durations-statuses',
      title: 'Durations + statuses',
      render: () => (
        <TimePicker
          defaultValue="09:30"
          slots={sampleSlots}
          maxHeight={140}
          durations={[{ value: 15 }, { value: 30 }, { value: 60 }, { value: 90 }]}
          defaultActiveDuration={30}
          statuses={[{ variant: 'available' }, { variant: 'busy' }, { variant: 'in-meeting' }]}
          defaultActiveStatus="available"
        />
      ),
      code: `import { TimePicker } from '@open-mercato/ui/primitives/time-picker'

<TimePicker
  defaultValue="09:30"
  slots={['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']}
  durations={[{ value: 15 }, { value: 30 }, { value: 60 }, { value: 90 }]}
  defaultActiveDuration={30}
  statuses={[{ variant: 'available' }, { variant: 'busy' }, { variant: 'in-meeting' }]}
  defaultActiveStatus="available"
/>`,
    },
    {
      id: 'with-trigger',
      title: 'With trigger (popover)',
      render: () => <DemoTimePickerTrigger />,
      code: `import { TimePicker } from '@open-mercato/ui/primitives/time-picker'
import { Button } from '@open-mercato/ui/primitives/button'

<TimePicker
  defaultValue="10:00"
  slots={['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']}
  trigger={<Button variant="outline">Pick a time</Button>}
/>`,
    },
    {
      id: 'atoms',
      title: 'Atoms (Slot / DurationChip / StatusChip)',
      render: () => (
        <div className="flex flex-col gap-3">
          <div className="flex w-56 flex-col gap-0.5">
            <TimePickerSlot value="09:30" />
            <TimePickerSlot value="10:00" selected />
            <TimePickerSlot value="10:30" disabled />
          </div>
          <div className="flex items-center gap-2">
            <TimePickerDurationChip value={30} />
            <TimePickerDurationChip value={90} selected />
          </div>
          <div className="flex items-center gap-2">
            <TimePickerStatusChip variant="available" selected />
            <TimePickerStatusChip variant="busy" />
            <TimePickerStatusChip variant="in-meeting" icon={<Clock className="size-3" aria-hidden="true" />} />
          </div>
        </div>
      ),
      code: `import { Clock } from 'lucide-react'
import {
  TimePickerSlot,
  TimePickerDurationChip,
  TimePickerStatusChip,
} from '@open-mercato/ui/primitives/time-picker'

<TimePickerSlot value="10:00" selected />
<TimePickerDurationChip value={90} selected />
<TimePickerStatusChip variant="busy" />
<TimePickerStatusChip variant="in-meeting" icon={<Clock className="size-3" />} />`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  calendarEntry,
  datePickerEntry,
  dateRangePickerEntry,
  timePickerEntry,
]
