/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { InlineActivityComposer } from '../InlineActivityComposer'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(async () => ({})),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

async function clickButton(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

function expectLocalDay(value: unknown, year: number, month: number, day: number) {
  expect(value).toBeInstanceOf(Date)
  const selectedDate = value as Date
  expect([selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()]).toEqual([
    year, month - 1, day,
  ])
}

describe('InlineActivityComposer calendar scheduling (#7478)', () => {
  beforeEach(() => {
    localStorage.clear()
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 30, 14, 12))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('schedules with the next-month day selected in the real week calendar', async () => {
    const onScheduleRequested = jest.fn()
    await act(async () => {
      renderWithProviders(
        <InlineActivityComposer entityType="person" entityId="person-1" onScheduleRequested={onScheduleRequested} />,
      )
    })

    await clickButton('1')
    await clickButton('Schedule')

    expectLocalDay(onScheduleRequested.mock.lastCall?.[0], 2026, 10, 1)
  })

  it('uses the latest selection after navigating to an earlier week', async () => {
    const onScheduleRequested = jest.fn()
    await act(async () => {
      renderWithProviders(
        <InlineActivityComposer entityType="company" entityId="company-1" onScheduleRequested={onScheduleRequested} />,
      )
    })

    await clickButton('1')
    await clickButton('Previous week')
    await clickButton('24')
    await clickButton('Schedule')

    expectLocalDay(onScheduleRequested.mock.lastCall?.[0], 2026, 9, 24)
  })

  it('uses the scheduling default without a selection and after toggling a selected day off', async () => {
    const onScheduleRequested = jest.fn()
    await act(async () => {
      renderWithProviders(
        <InlineActivityComposer entityType="deal" entityId="deal-1" onScheduleRequested={onScheduleRequested} />,
      )
    })

    await clickButton('Schedule')
    expect(onScheduleRequested).toHaveBeenLastCalledWith(undefined)

    await clickButton('30')
    await clickButton('Schedule')
    expectLocalDay(onScheduleRequested.mock.lastCall?.[0], 2026, 9, 30)

    await clickButton('30')
    await clickButton('Schedule')
    expect(onScheduleRequested).toHaveBeenLastCalledWith(undefined)
  })

  it('retains the chosen day when the week preview is hidden and shown again', async () => {
    const onScheduleRequested = jest.fn()
    await act(async () => {
      renderWithProviders(
        <InlineActivityComposer entityType="person" entityId="person-1" onScheduleRequested={onScheduleRequested} />,
      )
    })

    await clickButton('1')
    await clickButton('Hide week preview')
    await clickButton('Show week preview')
    await clickButton('Schedule')

    expectLocalDay(onScheduleRequested.mock.lastCall?.[0], 2026, 10, 1)

    await clickButton('1')
    await clickButton('Schedule')
    expect(onScheduleRequested).toHaveBeenLastCalledWith(undefined)
  })
})
