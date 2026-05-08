/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesDayStrip } from '../ActivitiesDayStrip'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
}))

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

describe('ActivitiesDayStrip — Today button (issue #1822)', () => {
  it('renders Today disabled when today is in the visible window and selected', () => {
    const today = startOfDay(new Date())
    renderWithProviders(
      <ActivitiesDayStrip entityId="person-1" selectedDate={today} onSelectDate={() => {}} events={[]} />,
    )
    const todayBtn = screen.getByRole('button', { name: /Today/i })
    expect(todayBtn).toBeDisabled()
  })

  it('enables Today after navigating the day window away from today', () => {
    const today = startOfDay(new Date())
    renderWithProviders(
      <ActivitiesDayStrip entityId="person-1" selectedDate={today} onSelectDate={() => {}} events={[]} />,
    )

    const nextWindow = screen.getByRole('button', { name: /Next days/i })
    act(() => {
      fireEvent.click(nextWindow)
    })

    const todayBtn = screen.getByRole('button', { name: /Today/i })
    expect(todayBtn).toBeEnabled()
  })

  it('calls onSelectDate with today when Today is clicked after navigating away', () => {
    const today = startOfDay(new Date())
    const onSelectDate = jest.fn()
    renderWithProviders(
      <ActivitiesDayStrip entityId="person-1" selectedDate={today} onSelectDate={onSelectDate} events={[]} />,
    )

    // Navigate forward by one window so Today becomes meaningful.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Next days/i }))
    })

    const todayBtn = screen.getByRole('button', { name: /Today/i })
    act(() => {
      fireEvent.click(todayBtn)
    })

    expect(onSelectDate).toHaveBeenCalledTimes(1)
    const passed = onSelectDate.mock.calls[0][0] as Date
    expect(passed.getFullYear()).toBe(today.getFullYear())
    expect(passed.getMonth()).toBe(today.getMonth())
    expect(passed.getDate()).toBe(today.getDate())
  })
})
