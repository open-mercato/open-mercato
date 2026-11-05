/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CalendarToolbar } from '../CalendarToolbar'
import type { CalendarToolbarProps } from '../types'

function baseProps(): CalendarToolbarProps {
  const anchor = new Date(2026, 0, 15)
  return {
    view: 'week',
    anchor,
    range: { from: anchor, to: anchor },
    preset: null,
    search: '',
    filters: { types: [], status: null, ownerUserId: null },
    typeOptions: [],
    ownerOptions: [],
    onToday: () => {},
    onPresetChange: () => {},
    onAnchorChange: () => {},
    onSearchChange: () => {},
    onFiltersChange: () => {},
    onOpenSettings: () => {},
  }
}

async function openRangeCalendar() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /2026/ }))
  })
}

// The mini calendar in the date-range popover is the raw `Calendar` primitive, not
// `DatePicker` — it does not inherit the primitive-level app-locale default and must be
// passed `locale` explicitly. Regression coverage for the #5942 sibling gap: this popover
// rendered English/Sunday-first for every tenant before the fix.
describe('CalendarToolbar — the range popover calendar follows the app locale', () => {
  it('renders the mini calendar in the app locale', async () => {
    renderWithProviders(<CalendarToolbar {...baseProps()} />, { locale: 'pl' })
    await openRangeCalendar()
    expect(screen.getByText(/styczeń 2026/)).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')[0]).toHaveAttribute('data-day', '2025-12-29')
  })

  it('leaves the mini calendar in English for an English app', async () => {
    renderWithProviders(<CalendarToolbar {...baseProps()} />, { locale: 'en' })
    await openRangeCalendar()
    expect(screen.getByText(/January 2026/)).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')[0]).toHaveAttribute('data-day', '2025-12-28')
  })
})
