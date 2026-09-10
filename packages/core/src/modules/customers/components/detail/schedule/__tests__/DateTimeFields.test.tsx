/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DateTimeFields } from '../DateTimeFields'
import { FIELD_VISIBILITY, type ActivityType } from '../fieldConfig'

describe('DateTimeFields — per-type date requiredness (#5941)', () => {
  function renderFields(activityType: ActivityType, date: string) {
    return renderWithProviders(
      <DateTimeFields
        visible={FIELD_VISIBILITY[activityType]}
        activityType={activityType}
        date={date}
        setDate={() => {}}
        startTime=""
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
        recurrenceCount={8}
        setRecurrenceCount={() => {}}
        recurrenceEndDate=""
        setRecurrenceEndDate={() => {}}
      />,
    )
  }

  function dateTrigger(container: HTMLElement): HTMLElement {
    const trigger = container.querySelector('[data-slot="date-picker-trigger"]')
    if (!trigger) throw new Error('[internal] date picker trigger not rendered')
    return trigger as HTMLElement
  }

  it('does not demand a due date from a task, so a backlog item stays valid while blank', () => {
    const { container } = renderFields('task', '')

    expect(screen.queryByText('Date is required')).not.toBeInTheDocument()
    expect(screen.queryByText('Time is required')).not.toBeInTheDocument()
    expect(dateTrigger(container)).not.toHaveAttribute('aria-required')
  })

  it('still demands a date from a calendar-bound meeting', () => {
    const { container } = renderFields('meeting', '')

    expect(screen.getByText('Date is required')).toBeInTheDocument()
    expect(dateTrigger(container)).toHaveAttribute('aria-required', 'true')
  })

  it('drops the required error once the meeting has a date', () => {
    renderFields('meeting', '2026-05-15')

    expect(screen.queryByText('Date is required')).not.toBeInTheDocument()
  })
})
