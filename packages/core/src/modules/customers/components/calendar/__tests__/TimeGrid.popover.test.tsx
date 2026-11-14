/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TimeGrid } from '../TimeGrid'
import { buildCalendarItem } from './fixtures'

function renderCalendar({ mobile, days, allDay = false }: { mobile: boolean; days: 1 | 7; allDay?: boolean }) {
  jest.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query.includes('max-width') && mobile,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }))
  return renderWithProviders(
    <TimeGrid
      days={days}
      anchor={new Date(2026, 7, 10)}
      items={[buildCalendarItem({ allDay, location: 'https://meet.google.com/calendar-test' })]}
      conflictIds={new Set()}
      showWeekends={false}
      showConflicts={false}
      aiSummaries={false}
      onItemClick={jest.fn()}
      onJoin={jest.fn()}
      onNavigate={jest.fn()}
    />,
  )
}

describe('TimeGrid peek placement and dismissal (#8868)', () => {
  afterEach(() => jest.restoreAllMocks())

  it.each([false, true])('opens phone Week events vertically (all day: %s)', (allDay) => {
    renderCalendar({ mobile: true, days: 7, allDay })
    fireEvent.click(screen.getByRole('button', { name: /Quarterly review/ }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-side', 'bottom')
    expect(screen.getByRole('button', { name: 'Join' })).toBeVisible()
  })

  it.each([false, true])('opens phone Day events vertically (all day: %s)', (allDay) => {
    renderCalendar({ mobile: true, days: 1, allDay })
    fireEvent.click(screen.getByRole('button', { name: /Quarterly review/ }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-side', 'bottom')
    expect(screen.getByRole('button', { name: 'Join' })).toBeVisible()
  })

  it.each([
    { mobile: false, days: 7 as const },
    { mobile: false, days: 1 as const },
  ])('preserves the requested side for mobile=$mobile, days=$days', ({ mobile, days }) => {
    renderCalendar({ mobile, days })
    fireEvent.click(screen.getByRole('button', { name: /Quarterly review/ }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-side', 'right')
  })

  it('dismisses the phone Week peek with Escape and restores focus to its trigger', async () => {
    renderCalendar({ mobile: true, days: 7 })
    const trigger = screen.getByRole('button', { name: /Quarterly review/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeVisible()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('dismisses the phone Week peek when the pointer lands outside', async () => {
    renderCalendar({ mobile: true, days: 7 })
    fireEvent.click(screen.getByRole('button', { name: /Quarterly review/ }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
