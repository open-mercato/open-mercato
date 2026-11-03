/**
 * @jest-environment jsdom
 */
// T5.2 — screen 11. The three notes that are visual decisions rather than data:
// the load bar, the dashed non-billable chip, and `+ dodaj` on every in-period
// day (reachable by keyboard, not only by hover).

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { TimesheetCalendar } from '../TimesheetCalendar'
import { buildTimesheetDays, indexDaysByDate, type TimesheetEntry } from '../timesheetData'

const mockTranslate = (key: string, fallback?: string): string => fallback ?? key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

const MONTH = { from: '2026-07-01', to: '2026-07-31' }

function entry(overrides: Partial<TimesheetEntry> & { id: string; date: string }): TimesheetEntry {
  return {
    taskId: null,
    taskTitle: null,
    timeProjectId: 'p1',
    projectLabel: 'Nordvik — cart',
    description: null,
    startText: '',
    endText: '',
    durationMinutes: 315,
    roundedMinutes: null,
    isBillable: true,
    cost: null,
    currencyCode: null,
    rateOverrideAmount: null,
    isLocked: false,
    lockedReportId: null,
    updatedAt: null,
    tagIds: [],
    staffMemberId: 'staff-1',
    ...overrides,
  }
}

function renderCalendar(entries: TimesheetEntry[], onAddEntry = jest.fn(), onSelectEntry = jest.fn()) {
  const days = buildTimesheetDays(MONTH, entries)
  render(
    <TimesheetCalendar
      monthAnchors={['2026-07-01']}
      days={indexDaysByDate(days)}
      scaleMinutes={480}
      todayDate="2026-07-20"
      onAddEntry={onAddEntry}
      onSelectEntry={onSelectEntry}
      locale="en-GB"
    />,
  )
  return { onAddEntry, onSelectEntry }
}

describe('TimesheetCalendar', () => {
  it('shows a per-day total and a load bar scaled to the daily target', () => {
    renderCalendar([entry({ id: 'a', date: '2026-07-01', durationMinutes: 465 })])
    expect(screen.getAllByText('7:45').length).toBeGreaterThan(0)
    const bar = document.querySelector('[data-slot="progress"]') as HTMLElement
    expect(bar).toHaveAttribute('aria-valuenow', '97')
  })

  it('marks a non-billable entry with a dashed border rather than a colour (note 3)', () => {
    renderCalendar([
      entry({ id: 'billable', date: '2026-07-01', projectLabel: 'Ambra — audit' }),
      entry({ id: 'internal', date: '2026-07-01', projectLabel: 'Internal status', isBillable: false }),
    ])
    const nonBillable = screen.getByRole('button', { name: /Internal status/ })
    expect(nonBillable.className).toContain('border-dashed')
    expect(nonBillable).toHaveAttribute('title', 'Non-billable')
    const billable = screen.getByRole('button', { name: /Ambra — audit/ })
    expect(billable.className).not.toContain('border-dashed')
  })

  it('offers "+ add" on every in-period day and hands the dialog that day (note 2)', () => {
    const { onAddEntry } = renderCalendar([])
    const addButtons = screen.getAllByRole('button', { name: /\+ add/ })
    expect(addButtons).toHaveLength(31)
    fireEvent.click(screen.getByRole('button', { name: /\+ add — Wednesday,? 1 July 2026/ }))
    expect(onAddEntry).toHaveBeenCalledWith('2026-07-01')
  })

  it('opens an entry from its chip', () => {
    const { onSelectEntry } = renderCalendar([entry({ id: 'a', date: '2026-07-02' })])
    fireEvent.click(screen.getByRole('button', { name: /Nordvik — cart/ }))
    expect(onSelectEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('draws the neighbouring months as out-of-period cells with no add affordance', () => {
    renderCalendar([])
    // 29 and 30 June lead the first row; they carry no "+ add".
    expect(screen.queryByRole('button', { name: /\+ add — Monday,? 29 June 2026/ })).not.toBeInTheDocument()
  })
})
