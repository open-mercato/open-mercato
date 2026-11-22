/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { InlineActivityComposer } from '../InlineActivityComposer'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const miniWeekCalendarMock = jest.fn((_props: { refreshKey?: number }) => (
  <div data-testid="mini-week-calendar">mini-week-calendar</div>
))

jest.mock('../MiniWeekCalendar', () => ({
  MiniWeekCalendar: (props: { refreshKey?: number }) => miniWeekCalendarMock(props),
}))

describe('InlineActivityComposer', () => {
  beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
  })

  describe('activity time', () => {
    const openedAt = new Date('2026-11-14T21:44:00.000Z')
    const savedAt = new Date('2026-11-14T21:47:32.000Z')

    beforeEach(() => {
      jest.useFakeTimers({ now: openedAt })
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('shows the browser-local time and saves the current instant when the date is untouched', async () => {
      renderWithProviders(<InlineActivityComposer entityType="deal" entityId="deal-1" />)

      const localTime = openedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      expect(screen.getByText(`Today, ${localTime}`)).toBeInTheDocument()

      fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Called the customer' } })
      jest.setSystemTime(savedAt)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
      })

      expect(apiCallOrThrow).toHaveBeenCalledWith('/api/customers/interactions', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(`"occurredAt":"${savedAt.toISOString()}"`),
      }))
    })

    it('saves an edited wall time in the browser time zone and resets to the default', async () => {
      renderWithProviders(<InlineActivityComposer entityType="person" entityId="person-1" />)

      const description = screen.getByRole('textbox', { name: 'Description' })
      const chosenTime = '2026-11-14T12:35'
      fireEvent.change(screen.getByLabelText(/Today,/), { target: { value: chosenTime } })
      fireEvent.change(description, { target: { value: 'Earlier call' } })
      jest.setSystemTime(savedAt)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
      })

      expect(apiCallOrThrow).toHaveBeenLastCalledWith('/api/customers/interactions', expect.objectContaining({
        body: expect.stringContaining(`"occurredAt":"${new Date(2026, 10, 14, 12, 35).toISOString()}"`),
      }))
      const localTime = savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      expect(screen.getByText(`Today, ${localTime}`)).toBeInTheDocument()

      const nextSavedAt = new Date('2026-11-14T21:49:18.000Z')
      fireEvent.change(description, { target: { value: 'Another call' } })
      jest.setSystemTime(nextSavedAt)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
      })

      expect(apiCallOrThrow).toHaveBeenLastCalledWith('/api/customers/interactions', expect.objectContaining({
        body: expect.stringContaining(`"occurredAt":"${nextSavedAt.toISOString()}"`),
      }))
    })
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

  it('forwards the host refresh key to the week preview so it follows changes made outside the composer (#9487)', () => {
    const { rerender } = renderWithProviders(
      <InlineActivityComposer entityType="deal" entityId="person-1" refreshKey={3} />,
    )
    expect(miniWeekCalendarMock.mock.calls.at(-1)?.[0].refreshKey).toBe(3)

    rerender(<InlineActivityComposer entityType="deal" entityId="person-1" refreshKey={4} />)
    expect(miniWeekCalendarMock.mock.calls.at(-1)?.[0].refreshKey).toBe(4)
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
})
