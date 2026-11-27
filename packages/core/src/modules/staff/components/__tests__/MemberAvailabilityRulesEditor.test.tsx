/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { ScheduleItem, ScheduleRange } from '@open-mercato/ui/backend/schedule'
import { fetchScopedCalendarAppointments } from '@open-mercato/core/helpers/calendar/interactionCandidates'
import { MemberAvailabilityRulesEditor } from '../MemberAvailabilityRulesEditor'

jest.mock('@open-mercato/core/helpers/calendar/interactionCandidates', () => ({
  fetchScopedCalendarAppointments: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [{
    id: 'ordinary-rule',
    kind: 'availability',
    rrule: 'DTSTART:20260901T090000Z\nDURATION:PT8H\nRRULE:FREQ=WEEKLY',
    timezone: 'UTC',
  }] } })),
}))

jest.mock('@open-mercato/ui/backend/schedule', () => ({
  ScheduleView: ({ items, range, onItemClick, onRangeChange }: {
    items: ScheduleItem[]
    range: ScheduleRange
    onItemClick: (item: ScheduleItem) => void
    onRangeChange: (range: ScheduleRange) => void
  }) => (
    <section aria-label="Rendered schedule">
      {items.map((item) => <button key={item.id} onClick={() => onItemClick(item)} data-all-day={item.allDay}>{item.title}</button>)}
      <button onClick={() => {
        const start = new Date(range.start.getFullYear(), range.start.getMonth() + 1, 1)
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
        onRangeChange({ start, end })
      }}>Next range</button>
    </section>
  ),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/staff/my-availability',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

const fetchAppointments = jest.mocked(fetchScopedCalendarAppointments)
const organizationId = 'ac78983d-70cf-4a09-bdb9-1fd4eafbc311'
const userId = 'ebfd217f-c8c9-4794-a983-c8b700263b63'
const memberId = '8a46b8b5-1c24-4a85-92b7-62e1afe4d932'
const appointment = {
  id: 'crm-occurrence',
  title: 'Calendar appointment',
  start: new Date('2026-09-01T05:00:00Z'),
  end: new Date('2026-09-02T05:00:00Z'),
  allDay: true,
}

function renderEditor(linkedUserId: string | null = userId) {
  return renderWithProviders(
    <MemberAvailabilityRulesEditor mode="availability" subjectId={memberId} memberOrganizationId={organizationId} memberUserId={linkedUserId} />,
  )
}

beforeEach(() => fetchAppointments.mockReset())

it('loads appointments without blocking the schedule and does not edit them as rules', async () => {
  let resolveFeed: (result: Awaited<ReturnType<typeof fetchScopedCalendarAppointments>>) => void = () => {}
  fetchAppointments.mockImplementationOnce(() => new Promise((resolve) => { resolveFeed = resolve }))
  renderEditor()
  expect(fetchAppointments).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Calendar', exact: true }))

  expect(await screen.findByText('Loading calendar events…')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Rendered schedule' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Weekly availability', exact: true })).toBeInTheDocument()
  const { from, to } = fetchAppointments.mock.calls[0][0]
  expect(fetchAppointments).toHaveBeenCalledWith(expect.objectContaining({ userId, organizationId, signal: expect.any(AbortSignal) }))
  expect(from.getDate()).toBe(1)
  expect(to.getDate()).toBe(1)
  expect(to.getTime()).toBeGreaterThan(from.getTime())

  await act(async () => resolveFeed({ items: [appointment], truncated: true }))
  expect(screen.getByText('Some calendar events are not shown.')).toBeInTheDocument()
  const booked = screen.getByRole('button', { name: 'Calendar appointment' })
  expect(booked).toHaveAttribute('data-all-day', 'true')
  fireEvent.click(booked)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('cancels requests across range changes and keeps availability editable when bookings are unavailable', async () => {
  let resolveOld: (result: Awaited<ReturnType<typeof fetchScopedCalendarAppointments>>) => void = () => {}
  fetchAppointments
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    .mockResolvedValueOnce(null)
  renderEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Calendar', exact: true }))
  await waitFor(() => expect(fetchAppointments).toHaveBeenCalledTimes(1))
  const oldSignal = fetchAppointments.mock.calls[0][0].signal

  fireEvent.click(await screen.findByRole('button', { name: 'Next range' }))
  await screen.findByText('Calendar events are unavailable.')
  expect(oldSignal.aborted).toBe(true)
  await act(async () => resolveOld({ items: [appointment], truncated: false }))
  expect(screen.queryByText('Calendar appointment')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Weekly availability', exact: true })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Weekly availability', exact: true }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

it('keeps the regular schedule when the member has no linked user', async () => {
  renderEditor(null)
  fireEvent.click(screen.getByRole('button', { name: 'Calendar', exact: true }))
  expect(await screen.findByRole('region', { name: 'Rendered schedule' })).toBeInTheDocument()
  expect(screen.queryByText('Calendar events are unavailable.')).not.toBeInTheDocument()
  expect(fetchAppointments).not.toHaveBeenCalled()
})
