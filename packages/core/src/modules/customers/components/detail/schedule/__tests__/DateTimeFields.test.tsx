/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import polishTranslations from '../../../../i18n/pl.json'
import { DateTimeFields } from '../DateTimeFields'
import { FIELD_VISIBILITY, type ActivityType, type ScheduleFieldId } from '../fieldConfig'

describe('DateTimeFields — per-type date requiredness (#5941)', () => {
  function renderFields(activityType: ActivityType, date: string) {
    return renderWithProviders(
      <DateTimeFields
        visible={FIELD_VISIBILITY[activityType]}
        activityType={activityType}
        date={date}
        setDate={() => {}}
        startTime=""
        setStartTime={() => {}}
        duration={30}
        setDuration={() => {}}
        allDay={false}
        setAllDay={() => {}}
        recurrenceEnabled={false}
        setRecurrenceEnabled={() => {}}
        recurrenceDays={[false, false, false, false, false, false, false]}
        toggleRecurrenceDay={() => {}}
        recurrenceEndType="never"
        setRecurrenceEndType={() => {}}
        recurrenceCount={8}
        setRecurrenceCount={() => {}}
        recurrenceEndDate=""
        setRecurrenceEndDate={() => {}}
      />,
    )
  }

  function dateTrigger(container: HTMLElement): HTMLElement {
    const trigger = container.querySelector('[data-slot="date-picker-trigger"]')
    if (!trigger) throw new Error('[internal] date picker trigger not rendered')
    return trigger as HTMLElement
  }

  it('does not demand a due date from a task, so a backlog item stays valid while blank', () => {
    const { container } = renderFields('task', '')

    expect(screen.queryByText('Date is required')).not.toBeInTheDocument()
    expect(screen.queryByText('Time is required')).not.toBeInTheDocument()
    expect(dateTrigger(container)).not.toHaveAttribute('aria-required')
  })

  it('still demands a date from a calendar-bound meeting', () => {
    const { container } = renderFields('meeting', '')

    expect(screen.getByText('Date is required')).toBeInTheDocument()
    expect(dateTrigger(container)).toHaveAttribute('aria-required', 'true')
  })

  it('drops the required error once the meeting has a date', () => {
    renderFields('meeting', '2026-05-15')

    expect(screen.queryByText('Date is required')).not.toBeInTheDocument()
  })
})

describe('DateTimeFields — pickers follow the app locale', () => {
  const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
  })
  afterAll(() => {
    if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  const VISIBLE_FIELDS: ScheduleFieldId[] = ['date', 'startTime', 'duration']

  function renderFields(locale: string) {
    return renderWithProviders(
      <DateTimeFields
        visible={new Set(VISIBLE_FIELDS)}
        activityType="meeting"
        date="2026-01-15"
        setDate={() => {}}
        startTime="14:30"
        setStartTime={() => {}}
        duration={30}
        setDuration={() => {}}
        allDay={false}
        setAllDay={() => {}}
        recurrenceEnabled={false}
        setRecurrenceEnabled={() => {}}
        recurrenceDays={[false, false, false, false, false, false, false]}
        toggleRecurrenceDay={() => {}}
        recurrenceEndType="never"
        setRecurrenceEndType={() => {}}
        recurrenceCount={1}
        setRecurrenceCount={() => {}}
        recurrenceEndDate=""
        setRecurrenceEndDate={() => {}}
      />,
      { locale, dict: locale === 'pl' ? polishTranslations : {} },
    )
  }

  async function openDatePicker() {
    const trigger = document.querySelector('[data-slot="date-picker-trigger"]')
    if (!trigger) throw new Error('DatePicker trigger not found')
    await act(async () => {
      fireEvent.click(trigger as HTMLElement)
    })
  }

  // 2025-12-29 is a Monday and 2025-12-28 the Sunday before it, so the first cell of the
  // January 2026 grid says which day the calendar treats as the start of the week.
  it('renders the calendar in the app locale rather than the picker default', async () => {
    renderFields('pl')
    await openDatePicker()
    expect(screen.getByText(/styczeń 2026/)).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')[0]).toHaveAttribute('data-day', '2025-12-29')
  })

  it('renders the calendar in English for an English app', async () => {
    renderFields('en')
    await openDatePicker()
    expect(screen.getByText(/January 2026/)).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')[0]).toHaveAttribute('data-day', '2025-12-28')
  })

  it('shows Polish duration choices without English fallbacks (#8048)', async () => {
    renderFields('pl')
    const trigger = screen.getAllByRole('combobox').find((element) => element.textContent === '30 min')
    expect(trigger).toBeDefined()
    await act(async () => {
      fireEvent.click(trigger!)
    })
    expect(await screen.findByRole('option', { name: '1 godzina' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2 godziny' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '1 hour' })).not.toBeInTheDocument()
  })

  it('shows the start time on the clock the app locale uses', () => {
    renderFields('pl')
    expect(screen.getByText('14:30')).toBeInTheDocument()

    renderFields('en')
    expect(screen.getByText('02:30 PM')).toBeInTheDocument()
  })
})

describe('DateTimeFields — recurrence card', () => {
  type RecurrenceEndType = 'never' | 'count' | 'date'

  function RecurrenceHarness({ onCount, onEndDate }: { onCount: (value: number) => void; onEndDate: (value: string) => void }) {
    const [endType, setEndType] = React.useState<RecurrenceEndType>('never')
    const [count, setCount] = React.useState(3)
    const [days, setDays] = React.useState([true, false, false, false, false, false, false])
    return (
      <DateTimeFields
        visible={FIELD_VISIBILITY.meeting}
        activityType="meeting"
        date="2026-01-15"
        setDate={() => {}}
        startTime="14:30"
        setStartTime={() => {}}
        duration={30}
        setDuration={() => {}}
        allDay={false}
        setAllDay={() => {}}
        recurrenceEnabled
        setRecurrenceEnabled={() => {}}
        recurrenceDays={days}
        toggleRecurrenceDay={(index) => setDays((current) => current.map((value, position) => (position === index ? !value : value)))}
        recurrenceEndType={endType}
        setRecurrenceEndType={setEndType}
        recurrenceCount={count}
        setRecurrenceCount={(value) => {
          setCount(value)
          onCount(value)
        }}
        recurrenceEndDate=""
        setRecurrenceEndDate={onEndDate}
      />
    )
  }

  function renderCard(locale = 'en') {
    const onCount = jest.fn()
    const onEndDate = jest.fn()
    renderWithProviders(<RecurrenceHarness onCount={onCount} onEndDate={onEndDate} />, {
      locale,
      dict: locale === 'pl' ? polishTranslations : {},
    })
    return { onCount, onEndDate }
  }

  it('has no inert Edit button', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('lets the user set how many occurrences the series runs for', () => {
    const { onCount } = renderCard()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'After occurrences' }))
    expect(screen.getByRole('button', { name: 'After occurrences' })).toHaveAttribute('aria-pressed', 'true')

    const countInput = screen.getByRole('spinbutton', { name: 'After occurrences' })
    expect(countInput).toHaveValue(3)
    fireEvent.change(countInput, { target: { value: '12' } })
    expect(onCount).toHaveBeenLastCalledWith(12)

    fireEvent.change(countInput, { target: { value: '0' } })
    expect(onCount).toHaveBeenLastCalledWith(1)
  })

  it('shows an end date picker only for the date ending', () => {
    const { container } = renderWithProviders(<RecurrenceHarness onCount={() => {}} onEndDate={() => {}} />)
    const pickerCount = () => container.querySelectorAll('[data-slot="date-picker-trigger"]').length
    const before = pickerCount()

    fireEvent.click(screen.getByRole('button', { name: 'On date' }))
    expect(pickerCount()).toBe(before + 1)
    expect(screen.getByRole('button', { name: 'On date', pressed: true })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Never' }))
    expect(pickerCount()).toBe(before)
  })

  it('labels the weekdays in the app locale and exposes their state', () => {
    renderCard('pl')
    const monday = screen.getByRole('button', { name: 'PN' })
    expect(monday).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'WT' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Mo' })).not.toBeInTheDocument()

    fireEvent.click(monday)
    expect(monday).toHaveAttribute('aria-pressed', 'false')
  })
})
