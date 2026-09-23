/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DateTimeFields } from '../DateTimeFields'
import type { ScheduleFieldId } from '../fieldConfig'

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
      recurrenceCount={1}
      setRecurrenceCount={() => {}}
      recurrenceEndDate=""
      setRecurrenceEndDate={() => {}}
    />,
    { locale },
  )
}

async function openDatePicker() {
  const trigger = document.querySelector('[data-slot="date-picker-trigger"]')
  if (!trigger) throw new Error('DatePicker trigger not found')
  await act(async () => {
    fireEvent.click(trigger as HTMLElement)
  })
}

describe('DateTimeFields — pickers follow the app locale', () => {
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

  it('shows the start time on the clock the app locale uses', () => {
    renderFields('pl')
    expect(screen.getByText('14:30')).toBeInTheDocument()

    renderFields('en')
    expect(screen.getByText('02:30 PM')).toBeInTheDocument()
  })
})
