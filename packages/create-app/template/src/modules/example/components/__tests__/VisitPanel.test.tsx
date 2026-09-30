/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import type { CalendarEventTypePanelProps } from '@open-mercato/core/modules/customers/calendar-event-types'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { VisitPanel } from '../VisitPanel'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn(), readApiResultOrThrow: jest.fn() }))


const props: CalendarEventTypePanelProps = {
  definition: {
    key: 'visit', label: 'Visit', color: null, icon: null, builtIn: false,
    behavior: { schemaVersion: 1, baseKind: 'event', selectable: true, order: 450,
      fields: { endTime: true, allDay: false, recurrence: false, location: 'location', people: 'recipients', priority: false, resources: true },
      customFieldsetIds: [],
    },
  } as CalendarEventTypePanelProps['definition'],
  values: { date: '2026-10-01', startTime: '10:00', endDate: '2026-10-01', endTime: '11:00',
    participants: [{ userId: '11111111-1111-4111-8111-111111111111', name: 'Alex' }],
    resources: [{ id: '33333333-3333-4333-8333-333333333333', label: 'Room' }],
  },
  mode: 'create', errors: {}, disabled: false, capabilities: { staffEnabled: false, resourcesEnabled: false }, setValue: jest.fn(),
}

describe('VisitPanel optional availability modules', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.mocked(apiCall).mockReset()
    jest.mocked(apiCall).mockResolvedValue({ ok: true, status: 200, result: { subjects: [], warnings: [] },
      response: {} as Response, cacheStatus: null })
  })
  afterEach(() => jest.useRealTimers())

  it('keeps the supplied standard panel and avoids checking absent staff and resources', async () => {
    render(<VisitPanel {...props}><div data-testid="standard-calendar-fields" /></VisitPanel>)
    expect(screen.getByTestId('example-visit-optional-modules-warning')).toHaveTextContent('example.calendar.visitAvailability.staffDisabled')
    expect(screen.getByTestId('example-visit-optional-modules-warning')).toHaveTextContent('example.calendar.visitAvailability.resourcesDisabled')
    expect(screen.getByTestId('standard-calendar-fields')).toBeInTheDocument()
    expect(document.querySelector('input[type="date"], input[type="time"]')).toBeNull()
    await act(async () => { jest.advanceTimersByTime(250) })
    const url = new URL(String(jest.mocked(apiCall).mock.calls[0]?.[0]), 'http://localhost')
    expect(url.searchParams.has('staffUserIds')).toBe(false)
    expect(url.searchParams.has('resourceIds')).toBe(false)
  })

  it('shows recipient and linked-resource errors alongside the supplied panel', () => {
    render(<VisitPanel {...props} capabilities={{ staffEnabled: true, resourcesEnabled: true }} errors={{
      participants: 'Participant unavailable', linkedEntities: 'Resource unavailable',
    }} />)
    expect(screen.getByText('Participant unavailable')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('Resource unavailable')).toHaveAttribute('role', 'alert')
  })

  it('displays planner warnings returned by the API', async () => {
    jest.mocked(apiCall).mockResolvedValue({ ok: true, status: 200,
      result: { subjects: [], warnings: ['example.calendar.visitAvailability.plannerDisabled'] },
      response: {} as Response, cacheStatus: null })
    render(<VisitPanel {...props} capabilities={{ staffEnabled: true, resourcesEnabled: true }} />)
    await act(async () => { jest.advanceTimersByTime(250) })
    expect(screen.getByTestId('example-visit-optional-modules-warning')).toHaveTextContent('example.calendar.visitAvailability.plannerDisabled')

  })
})
