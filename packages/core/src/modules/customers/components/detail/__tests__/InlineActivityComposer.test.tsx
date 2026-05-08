/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { InlineActivityComposer } from '../InlineActivityComposer'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

type MiniWeekCalendarProps = { onDaySelect?: (date: Date) => void }
const capturedMiniWeekCalendarProps: { current: MiniWeekCalendarProps | null } = { current: null }

jest.mock('../MiniWeekCalendar', () => ({
  MiniWeekCalendar: (props: MiniWeekCalendarProps) => {
    capturedMiniWeekCalendarProps.current = props
    return <div data-testid="mini-week-calendar">mini-week-calendar</div>
  },
}))

describe('InlineActivityComposer', () => {
  beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
    capturedMiniWeekCalendarProps.current = null
  })

  it('renders a 3-row autosize description textarea with an explicit label', () => {
    renderWithProviders(
      <InlineActivityComposer entityType="person" entityId="person-1" />,
    )

    const textarea = screen.getByRole('textbox', {
      name: /Description/i,
    }) as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea.rows).toBe(3)
    expect(textarea.className).toEqual(expect.stringContaining('min-h-[72px]'))
    expect(textarea.className).toEqual(expect.stringContaining('resize-none'))
  })

  it('shows the MiniWeekCalendar by default (hideWeekPreview=false)', () => {
    renderWithProviders(
      <InlineActivityComposer entityType="person" entityId="person-1" />,
    )
    expect(screen.getByTestId('mini-week-calendar')).toBeInTheDocument()
    // Toggle button must expose "hide" action because the calendar is visible.
    expect(
      screen.getByRole('button', { name: /Hide week preview/i }),
    ).toBeInTheDocument()
  })

  it('toggles the week preview off and persists the choice under the per-entity-kind key', () => {
    renderWithProviders(
      <InlineActivityComposer entityType="person" entityId="person-1" />,
    )

    const hideBtn = screen.getByRole('button', { name: /Hide week preview/i })
    act(() => {
      fireEvent.click(hideBtn)
    })

    // After toggling, calendar is unmounted and the button flips to "show".
    expect(screen.queryByTestId('mini-week-calendar')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Show week preview/i }),
    ).toBeInTheDocument()

    // Persistence goes through `usePersistedBooleanFlag` under the entity-type
    // keyed localStorage slot so the preference survives refreshes and follows
    // the user to other records of the same kind (company/person/deal).
    expect(localStorage.getItem('om:inline-composer:week-preview:person')).toBe(
      JSON.stringify('1'),
    )
  })

  it('stores the preference under a distinct key for each entity type', () => {
    const { rerender } = renderWithProviders(
      <InlineActivityComposer entityType="company" entityId="company-1" />,
    )
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Hide week preview/i }))
    })
    expect(localStorage.getItem('om:inline-composer:week-preview:company')).toBe(
      JSON.stringify('1'),
    )

    rerender(<InlineActivityComposer entityType="deal" entityId="deal-1" />)
    // The deal-keyed preference is independent from the company one.
    expect(localStorage.getItem('om:inline-composer:week-preview:deal')).toBeNull()
    expect(screen.getByTestId('mini-week-calendar')).toBeInTheDocument()
  })

  it('inherits the date from MiniWeekCalendar onDaySelect while preserving the previously-typed time (issue #1822)', () => {
    renderWithProviders(
      <InlineActivityComposer entityType="person" entityId="person-1" />,
    )

    const occurredInput = document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement
    expect(occurredInput).toBeInTheDocument()

    // Simulate the user typing a non-default time before picking a day in the calendar.
    act(() => {
      fireEvent.change(occurredInput, { target: { value: '2026-05-08T14:30' } })
    })
    expect(occurredInput.value).toBe('2026-05-08T14:30')

    // The composer wires its handleCalendarDaySelect into MiniWeekCalendar.onDaySelect.
    expect(typeof capturedMiniWeekCalendarProps.current?.onDaySelect).toBe('function')

    // Picking May 15 must change only the date portion; the typed 14:30 stays.
    act(() => {
      capturedMiniWeekCalendarProps.current!.onDaySelect!(new Date(2026, 4, 15))
    })
    expect(occurredInput.value).toBe('2026-05-15T14:30')
  })
})
