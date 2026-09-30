/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import type { CalendarEventTypePanelProps } from '@open-mercato/core/modules/customers/calendar-event-types'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import widget from '../../widgets/injection/visit-availability/widget'
import { VisitPanel } from '../VisitPanel'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => require('@open-mercato/shared/lib/i18n/translate').createTranslator(require('../../i18n/en.json')) }))
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
    expect(screen.getByTestId('example-visit-optional-modules-warning')).toHaveTextContent('The staff module is not enabled.')
    expect(screen.getByTestId('example-visit-optional-modules-warning')).toHaveTextContent('The resources module is not enabled.')
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
    expect(screen.getByTestId('example-visit-optional-modules-warning')).toHaveTextContent('The planner module is not enabled.')

  })
  it('lists every blocked staff member and resource with its own name and cause', async () => {
    jest.mocked(apiCall).mockResolvedValue({ ok: true, status: 200, result: { subjects: [
      { type: 'staff', id: '11111111-1111-4111-8111-111111111111', displayName: 'Alex server', status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.unavailable' },
      { type: 'staff', id: '22222222-2222-4222-8222-222222222222', displayName: 'Sam', status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.booked' },
      { type: 'resource', id: '33333333-3333-4333-8333-333333333333', displayName: null, status: 'unknown', reasonKey: 'example.calendar.visitAvailability.noSchedule' },
      { type: 'resource', id: '44444444-4444-4444-8444-444444444444', displayName: 'Desk', status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.booked' },
    ] }, response: {} as Response, cacheStatus: null })
    render(<VisitPanel {...props} capabilities={{ staffEnabled: true, resourcesEnabled: true }} />)
    await act(async () => { jest.advanceTimersByTime(250) })
    const warning = screen.getByTestId('example-visit-unavailable-subjects')
    expect(warning.querySelectorAll('li')).toHaveLength(4)
    expect(warning).toHaveTextContent('Alex server: Outside available working hours.')
    expect(warning).toHaveTextContent('Sam: Already booked during this visit.')
    expect(warning).toHaveTextContent('Room: No availability schedule covers the visit.')
    expect(warning).toHaveTextContent('Desk: Already booked during this visit.')
    expect(warning).not.toHaveTextContent('11111111-1111-4111-8111-111111111111')
  })

  it('registers the host translator for the headless save handler without modifying shared forms', async () => {
    const messages = new Map<string, unknown>()
    const context = { sharedState: { get: (key: string) => messages.get(key), set: (key: string, value: unknown) => messages.set(key, value) } }
    render(<widget.Widget context={context} />)
    jest.mocked(apiCall).mockResolvedValueOnce({ ok: true, status: 200,
      result: { items: [{ key: 'visit', behavior: { fields: { people: 'recipients', resources: true } } }] }, response: {} as Response, cacheStatus: null })
    jest.mocked(apiCall).mockResolvedValueOnce({ ok: true, status: 200, result: { subjects: [
      { type: 'staff', id: '11111111-1111-4111-8111-111111111111', displayName: 'Alex', status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.booked' },
    ] }, response: {} as Response, cacheStatus: null })
    expect(await widget.eventHandlers?.onBeforeSave?.({ ...props.values, category: 'visit' }, context)).toEqual({
      ok: false, fieldErrors: { participants: 'Alex: Already booked during this visit.' },
    })
  })

})
