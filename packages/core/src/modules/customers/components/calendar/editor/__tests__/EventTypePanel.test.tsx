/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { calendarEventTypes, type CalendarEventTypePanelProps } from '../../../../calendar-event-types'
import { createDefaultFormState } from '../../../../lib/calendar/editorPayload'

jest.mock('../ScheduleSection', () => ({
  ScheduleSection: ({ dateLabel, hasEnd, hasAllDay, startError, disabled, onDateChange }: {
    dateLabel: string; hasEnd: boolean; hasAllDay: boolean; startError?: string; disabled?: boolean; onDateChange: (date: string) => void
  }) => <button type="button" disabled={disabled} data-testid="schedule" data-label={dateLabel} data-end={String(hasEnd)} data-all-day={String(hasAllDay)} data-start-error={startError} onClick={() => onDateChange('2026-10-04')}>Schedule</button>,
}))
jest.mock('../RepeatField', () => ({ RepeatField: ({ untilError }: { untilError?: string }) => <div data-testid="repeat" data-until-error={untilError} /> }))
jest.mock('../PeopleField', () => ({ PeopleField: ({ mode, ariaLabel }: { mode: string; ariaLabel: string }) => <div data-testid="people" data-mode={mode} data-label={ariaLabel} /> }))
jest.mock('../LocationField', () => ({ LocationField: ({ variant }: { variant: string }) => <div data-testid="location" data-variant={variant} /> }))
jest.mock('../ResourcesField', () => ({ ResourcesField: () => <div data-testid="resources" /> }))
jest.mock('../PriorityField', () => ({ PriorityField: () => <div data-testid="priority" /> }))

import { DefaultEventTypePanel } from '../EventTypePanel'

function panelProps(key: string, setValue = jest.fn()): CalendarEventTypePanelProps {
  const definition = calendarEventTypes.find((item) => item.key === key)!
  return {
    definition: { ...definition, provenance: {}, historical: false },
    mode: 'create',
    values: createDefaultFormState(null),
    errors: {},
    disabled: false,
    capabilities: { resourcesEnabled: true, staffEnabled: true },
    setValue,
  }
}

describe('DefaultEventTypePanel', () => {
  test.each([
    ['meeting', true, true, true, 'location', 'multi', false],
    ['call', true, true, true, 'phoneLink', 'multi', false],
    ['email', false, true, true, null, 'multi', false],
    ['note', false, false, false, null, null, false],
    ['event', true, true, true, 'location', 'multi', false],
    ['task', true, true, true, null, 'single', true],
  ] as const)('renders the baseline %s controls', (key, hasEnd, hasAllDay, hasRepeat, location, people, hasPriority) => {
    const { unmount } = renderWithProviders(<DefaultEventTypePanel {...panelProps(key)} />)
    expect(screen.getByTestId('schedule')).toHaveAttribute('data-end', String(hasEnd))
    expect(screen.getByTestId('schedule')).toHaveAttribute('data-all-day', String(hasAllDay))
    expect(screen.queryByTestId('repeat') !== null).toBe(hasRepeat)
    expect(screen.queryByTestId('location')?.getAttribute('data-variant') ?? null).toBe(location)
    expect(screen.queryByTestId('people')?.getAttribute('data-mode') ?? null).toBe(people)
    expect(screen.queryByTestId('priority') !== null).toBe(hasPriority)
    expect(screen.getByTestId('resources')).toBeInTheDocument()
    unmount()
  })

  it('writes schedule changes through the host form setter', () => {
    const setValue = jest.fn()
    renderWithProviders(<DefaultEventTypePanel {...panelProps('meeting', setValue)} />)
    fireEvent.click(screen.getByTestId('schedule'))
    expect(setValue).toHaveBeenCalledWith('date', '2026-10-04')
  })

  it('disables every built-in panel control while saving', () => {
    const setValue = jest.fn()
    renderWithProviders(<DefaultEventTypePanel {...panelProps('meeting', setValue)} disabled />)
    expect(screen.getByTestId('schedule')).toBeDisabled()
    fireEvent.click(screen.getByTestId('schedule'))
    expect(setValue).not.toHaveBeenCalled()
  })

  it('routes start and until validation to their causal controls', () => {
    const props = panelProps('meeting')
    renderWithProviders(<DefaultEventTypePanel {...props} errors={{ startTime: 'Invalid start', repeatUntilDate: 'Invalid until' }} />)
    expect(screen.getByTestId('schedule')).toHaveAttribute('data-start-error', 'Invalid start')
    expect(screen.getByTestId('repeat')).toHaveAttribute('data-until-error', 'Invalid until')
  })
})
