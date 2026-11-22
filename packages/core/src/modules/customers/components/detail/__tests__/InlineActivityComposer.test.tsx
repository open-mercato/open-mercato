/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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

  it('renders a 3-row autosize description textarea with an explicit label', () => {
    renderWithProviders(
      <InlineActivityComposer entityType="person" entityId="person-1" />,
    )

    const textarea = screen.getByRole('textbox', {
      name: /Description/i,
    }) as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea.rows).toBe(3)
    expect(textarea.className).toEqual(expect.stringContaining('min-h-18'))
    expect(textarea.className).toEqual(expect.stringContaining('resize-none'))
  })

  describe('activity timestamps', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date(2026, 0, 15, 12))
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it.each([
      { day: 13, status: 'done', timestampField: 'occurredAt' },
      { day: 17, status: 'planned', timestampField: 'scheduledAt' },
    ])('saves the selected date and time as $status on the active customer and deal', async ({ day, status, timestampField }) => {
      const onActivityCreated = jest.fn()
      const runGuardedMutation = jest.fn(<Result,>(operation: () => Promise<Result>) => operation())
      renderWithProviders(
        <InlineActivityComposer
          entityType="company"
          entityId="company-1"
          dealId="deal-1"
          onActivityCreated={onActivityCreated}
          runGuardedMutation={runGuardedMutation}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Date and time' }))
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`January ${day}`) }))
      fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '09' } })
      fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '30' } })
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Renewal call' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))

      await waitFor(() => expect(onActivityCreated).toHaveBeenCalledTimes(1))
      const payload = {
        entityId: 'company-1',
        dealId: 'deal-1',
        interactionType: 'call',
        body: 'Renewal call',
        status,
        occurredAt: null,
        scheduledAt: null,
        [timestampField]: new Date(2026, 0, day, 9, 30).toISOString(),
      }
      expect(runGuardedMutation).toHaveBeenCalledWith(expect.any(Function), payload)
      expect(apiCallOrThrow).toHaveBeenCalledWith('/api/customers/interactions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }))
      expect(screen.getByRole('button', { name: 'Date and time' })).toHaveTextContent('Now')
    })

    it('uses the submit time when no date has been selected', async () => {
      const onActivityCreated = jest.fn()
      const runGuardedMutation = jest.fn(<Result,>(operation: () => Promise<Result>) => operation())
      renderWithProviders(
        <InlineActivityComposer
          entityType="person"
          entityId="person-1"
          onActivityCreated={onActivityCreated}
          runGuardedMutation={runGuardedMutation}
        />,
      )

      const submitTime = new Date(2026, 0, 15, 12, 15, 24)
      jest.setSystemTime(submitTime)
      const description = screen.getByRole('textbox', { name: 'Description' })
      fireEvent.change(description, { target: { value: 'Spoke to the customer' } })
      fireEvent.keyDown(description, { key: 'Enter', ctrlKey: true })

      await waitFor(() => expect(onActivityCreated).toHaveBeenCalledTimes(1))
      expect(runGuardedMutation).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
        status: 'done',
        occurredAt: submitTime.toISOString(),
        scheduledAt: null,
      }))
    })
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
