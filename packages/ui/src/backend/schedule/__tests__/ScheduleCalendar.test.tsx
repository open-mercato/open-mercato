import * as React from 'react'
import { act, render } from '@testing-library/react'
import type { CalendarProps } from 'react-big-calendar'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ScheduleCalendar from '../ScheduleCalendar'
import type { ScheduleItem } from '../types'

type TestEvent = { id: string; title: string; start: Date; end: Date; resource: ScheduleItem; allDay: boolean }
let calendarProps: CalendarProps<TestEvent>

jest.mock('react-big-calendar/lib/css/react-big-calendar.css', () => ({}))
jest.mock('react-big-calendar', () => ({
  Calendar: (props: CalendarProps<TestEvent>) => { calendarProps = props; return null },
  dateFnsLocalizer: jest.fn(() => ({})),
}))

const selectedRange = { start: new Date(2026, 5, 8), end: new Date(2026, 5, 14, 23, 59, 59) }
const items: ScheduleItem[] = [
  { id: 'closed', kind: 'exception', title: 'Closed', startsAt: new Date(2026, 5, 10), endsAt: new Date(2026, 5, 10, 23, 59) },
  { id: 'meeting', kind: 'event', title: 'Meeting', startsAt: new Date(2026, 5, 9, 10), endsAt: new Date(2026, 5, 9, 11, 30) },
  { id: 'night', kind: 'availability', title: 'Night shift', startsAt: new Date(2026, 5, 11, 23), endsAt: new Date(2026, 5, 12, 1) },
]

function renderCalendar() {
  const onRangeChange = jest.fn()
  const onItemClick = jest.fn()
  render(<I18nProvider locale="pl" dict={{ 'schedule.calendar.allDay': 'Cały dzień' }}>
    <ScheduleCalendar items={items} view="week" range={selectedRange} onRangeChange={onRangeChange} onViewChange={jest.fn()} onItemClick={onItemClick} />
  </I18nProvider>)
  return { onRangeChange, onItemClick }
}

describe('ScheduleCalendar', () => {
  it('puts full-day closures in the all-day row and keeps timed and overnight events timed', () => {
    renderCalendar()
    expect(calendarProps.events?.map(({ id, allDay }) => ({ id, allDay }))).toEqual([
      { id: 'closed', allDay: true }, { id: 'meeting', allDay: false }, { id: 'night', allDay: false },
    ])
  })

  it('opens at working hours without hiding the rest of the day', () => {
    renderCalendar()
    expect(calendarProps.scrollToTime?.getHours()).toBe(8)
    expect(calendarProps.min).toBeUndefined()
    expect(calendarProps.max).toBeUndefined()
  })

  it('retains the displayed date when changing the calendar view', () => {
    const { onRangeChange } = renderCalendar()
    act(() => calendarProps.onView?.('month'))
    expect(onRangeChange).toHaveBeenCalledWith({ start: new Date(2026, 5, 1), end: new Date(2026, 5, 30, 23, 59, 59, 999) })
  })

  it('navigates by Polish weeks and localizes the all-day label', () => {
    const { onRangeChange } = renderCalendar()
    act(() => calendarProps.onNavigate?.(new Date(2026, 5, 17), 'week', 'NEXT'))
    expect(onRangeChange).toHaveBeenCalledWith({ start: new Date(2026, 5, 15), end: new Date(2026, 5, 21, 23, 59, 59, 999) })
    expect(calendarProps.culture).toBe('pl')
    expect(calendarProps.messages?.allDay).toBe('Cały dzień')
  })

  it('passes the original schedule item when selecting an event', () => {
    const { onItemClick } = renderCalendar()
    const event = calendarProps.events?.find(({ id }) => id === 'meeting')
    expect(event).toBeDefined()
    act(() => calendarProps.onSelectEvent?.(event!, {} as React.SyntheticEvent))
    expect(onItemClick).toHaveBeenCalledWith(items[1])
  })
})
