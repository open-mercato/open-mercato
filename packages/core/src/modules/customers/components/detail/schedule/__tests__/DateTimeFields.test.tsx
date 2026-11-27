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
        recurrenceCount="8"
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
        recurrenceCount="1"
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

  it.each(['wheel', 'touchMove'] as const)('scopes %s suppression to the portaled time list', async (eventName) => {
    renderFields('en')
    const trigger = screen.getByRole('button', { name: '02:30 PM' })
    await act(async () => {
      fireEvent.click(trigger)
    })
    const timeSlot = await screen.findByRole('button', { name: '14:30' })
    const domEventName = eventName === 'wheel' ? 'wheel' : 'touchmove'
    const eventInit = eventName === 'wheel'
      ? { deltaY: 120 }
      : { touches: [{ clientX: 0, clientY: 0 }], changedTouches: [{ clientX: 0, clientY: 0 }] }
    const documentListener = jest.fn()
    document.addEventListener(domEventName, documentListener)

    try {
      fireEvent[eventName](timeSlot, eventInit)
      expect(documentListener).not.toHaveBeenCalled()

      fireEvent[eventName](trigger, eventInit)
      expect(documentListener).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener(domEventName, documentListener)
    }
  })
})

describe('DateTimeFields — recurrence card', () => {
  type RecurrenceEndType = 'never' | 'count' | 'date'

  function RecurrenceHarness({
    onCount,
    onEndDate,
    endDate = '',
  }: {
    onCount: (value: string) => void
    onEndDate: (value: string) => void
    endDate?: string
  }) {
    const [endType, setEndType] = React.useState<RecurrenceEndType>('never')
    const [count, setCount] = React.useState('3')
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
        recurrenceEndDate={endDate}
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
    expect(countInput).not.toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(countInput, { target: { value: '12' } })
    expect(onCount).toHaveBeenLastCalledWith('12')
    expect(countInput).toHaveValue(12)
  })

  it('keeps the occurrences field empty while the user replaces the number', () => {
    const { onCount } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'After occurrences' }))
    const countInput = screen.getByRole('spinbutton', { name: 'After occurrences' })

    fireEvent.change(countInput, { target: { value: '' } })
    expect(onCount).toHaveBeenLastCalledWith('')
    expect(countInput).toHaveValue(null)
    expect(countInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a whole number of 1 or more.')).toBeInTheDocument()

    fireEvent.change(countInput, { target: { value: '7' } })
    expect(onCount).toHaveBeenLastCalledWith('7')
    expect(countInput).toHaveValue(7)
    expect(countInput).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Enter a whole number of 1 or more.')).not.toBeInTheDocument()
  })

  it('flags zero instead of turning it into one', () => {
    const { onCount } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'After occurrences' }))
    const countInput = screen.getByRole('spinbutton', { name: 'After occurrences' })

    fireEvent.change(countInput, { target: { value: '0' } })
    expect(onCount).toHaveBeenLastCalledWith('0')
    expect(countInput).toHaveValue(0)
    expect(countInput).toHaveAttribute('aria-invalid', 'true')
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

  it('flags an end date before the first date and ties the message to the picker', () => {
    const { container } = renderWithProviders(
      <RecurrenceHarness onCount={() => {}} onEndDate={() => {}} endDate="2026-01-10" />,
    )
    expect(screen.queryByText('The series cannot end before its first date.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'On date' }))

    const message = screen.getByText('The series cannot end before its first date.')
    const endPicker = Array.from(container.querySelectorAll('[data-slot="date-picker-trigger"]')).at(-1)
    expect(endPicker).toHaveAttribute('aria-describedby', message.id)
  })

  it.each(['2026-01-15', '2026-02-01'])('accepts an end date of %s for a series starting 2026-01-15', (endDate) => {
    renderWithProviders(<RecurrenceHarness onCount={() => {}} onEndDate={() => {}} endDate={endDate} />)
    fireEvent.click(screen.getByRole('button', { name: 'On date' }))

    expect(screen.queryByText('The series cannot end before its first date.')).not.toBeInTheDocument()
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
