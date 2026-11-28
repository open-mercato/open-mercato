/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { fetchScopedCalendarAppointments } from '@open-mercato/core/helpers/calendar/interactionCandidates'
import { LeaveScheduledEvents } from '../LeaveScheduledEvents'

jest.mock('@open-mercato/core/helpers/calendar/interactionCandidates', () => ({
  fetchScopedCalendarAppointments: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useLocale: () => 'en-US',
  useT: () => (_key: string, fallback: string, variables?: { count: number }) => (
    variables ? fallback.replace('{count}', String(variables.count)) : fallback
  ),
}))

const load = jest.mocked(fetchScopedCalendarAppointments)
const props = {
  userId: 'bf276552-0f13-42d0-a851-cf4322908899',
  organizationId: '877fe793-1582-422e-977d-e80f34112dfd',
  startDate: '2026-03-08',
  endDate: '2026-03-08',
  timezone: 'America/New_York',
}
const event = {
  id: 'event',
  title: 'Implementation review',
  start: new Date('2026-03-08T16:00:00Z'),
  end: new Date('2026-03-08T17:00:00Z'),
  allDay: false,
}

beforeEach(() => load.mockReset())

test('uses the leave timezone boundaries and reports a partial result without an exact total', async () => {
  load.mockResolvedValue({ items: [event], truncated: true })
  render(<LeaveScheduledEvents {...props} />)
  expect(await screen.findByText(event.title)).toBeTruthy()
  expect(screen.getByText('Showing 1. More events may overlap these dates.')).toBeTruthy()
  expect(screen.queryByText('1 scheduled event')).toBeNull()
  expect(load).toHaveBeenCalledWith({
    userId: props.userId,
    organizationId: props.organizationId,
    from: new Date('2026-03-08T05:00:00Z'),
    to: new Date('2026-03-09T04:00:00Z'),
    signal: expect.any(AbortSignal),
  })
})

test('cancels an old scope and handles an unavailable result without showing zero', async () => {
  let resolveFirst: (value: Awaited<ReturnType<typeof fetchScopedCalendarAppointments>>) => void = () => {}
  load.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
  load.mockResolvedValueOnce(null)
  const { rerender } = render(<LeaveScheduledEvents {...props} />)
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  rerender(<LeaveScheduledEvents {...props} organizationId="9825a011-f8d7-4a5e-9488-931e4ec3d3c3" />)
  expect(await screen.findByText('Scheduled events are unavailable.')).toBeTruthy()
  expect(load.mock.calls[0][0].signal.aborted).toBe(true)
  await act(async () => resolveFirst({ items: [event], truncated: false }))
  expect(screen.queryByText(event.title)).toBeNull()
  expect(screen.queryByText('No scheduled events overlap these dates.')).toBeNull()
})
