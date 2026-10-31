/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesCard } from '../ActivitiesCard'
import { ActivityLogTab } from '../ActivityLogTab'
import type { ActivityKind } from '../ActivitiesAddNewMenu'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
}))

jest.mock('../ActivityHistorySection', () => ({
  ActivityHistorySection: () => null,
}))

async function clickButton(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

async function chooseActivity(label: string) {
  await clickButton('Add new')
  await clickButton(label)
}

describe('activity calendar create date (#7478)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 30, 14, 12))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it.each<[ActivityKind, string]>([
    ['meeting', 'New meeting'],
    ['call', 'Log call'],
    ['task', 'New task'],
    ['email', 'Compose email'],
  ])('forwards the selected next-month day for %s without changing its kind', async (kind, label) => {
    const onAddNew = jest.fn()
    await act(async () => {
      renderWithProviders(<ActivitiesCard entityId="person-1" plannedActivities={[]} onAddNew={onAddNew} />)
    })

    await clickButton('THU 01')
    await chooseActivity(label)

    expect(onAddNew).toHaveBeenCalledWith(kind, new Date(2026, 9, 1))
  })

  it('keeps default scheduling available until a day is explicitly selected', async () => {
    const onAddNew = jest.fn()
    await act(async () => {
      renderWithProviders(<ActivitiesCard entityId="person-1" plannedActivities={[]} onAddNew={onAddNew} />)
    })

    await chooseActivity('New meeting')
    expect(onAddNew).toHaveBeenLastCalledWith('meeting', undefined)

    await clickButton('WED 30')
    await chooseActivity('New meeting')
    expect(onAddNew).toHaveBeenLastCalledWith('meeting', new Date(2026, 8, 30))
  })

  it('forwards a previous-month selection through ActivityLogTab to the typed create handler', async () => {
    const onAddActivity = jest.fn()
    const onScheduleRequested = jest.fn()
    await act(async () => {
      renderWithProviders(
        <ActivityLogTab
          entityId="person-1"
          plannedActivities={[]}
          onAddActivity={onAddActivity}
          onScheduleRequested={onScheduleRequested}
          onEditActivity={() => {}}
        />,
      )
    })

    await clickButton('Previous month')
    await clickButton('MON 31')
    await chooseActivity('New task')

    expect(onAddActivity).toHaveBeenCalledWith('task', new Date(2026, 7, 31))
    expect(onScheduleRequested).not.toHaveBeenCalled()
  })

  it('forwards the selected day to the ActivityLogTab schedule fallback', async () => {
    const onScheduleRequested = jest.fn()
    await act(async () => {
      renderWithProviders(
        <ActivityLogTab
          entityId="company-1"
          plannedActivities={[]}
          onScheduleRequested={onScheduleRequested}
          onEditActivity={() => {}}
        />,
      )
    })

    await clickButton('THU 01')
    await chooseActivity('New meeting')

    expect(onScheduleRequested).toHaveBeenCalledWith(new Date(2026, 9, 1))
  })
})
