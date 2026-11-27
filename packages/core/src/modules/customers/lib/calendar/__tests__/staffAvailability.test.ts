import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { mapInteractionToCalendarItem } from '../mapItem'
import {
  calendarStaffAvailabilityCandidates,
  findStaffAvailabilityConflicts,
  getStaffAvailabilityWindows,
  loadStaffAvailability,
  staffAvailabilityUserIds,
} from '../staffAvailability'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const call = jest.mocked(apiCall)
const organizationId = '34275375-bb71-4cec-97db-5f5b84558c75'
const secondOrganizationId = '34275375-bb71-4cec-97db-5f5b84558c76'
const ownerId = '98275375-bb71-4cec-97db-5f5b84558c75'
const attendeeId = '98275375-bb71-4cec-97db-5f5b84558c76'
const range = { from: new Date('2026-11-22T11:00:00.000Z'), to: new Date('2026-11-22T12:00:00.000Z') }
const leave = { start: range.from.toISOString(), end: range.to.toISOString(), kind: 'leave', reason: 'Time off' }
const signal = new AbortController().signal

function respond(items: unknown[]) {
  call.mockResolvedValue({ ok: true, result: { items } } as Awaited<ReturnType<typeof apiCall>>)
}

beforeEach(() => {
  call.mockReset()
})

test('only complete and recognized users can be described as available', async () => {
  respond([{ userId: ownerId, organizationId, windows: [] }])
  const data = await loadStaffAvailability([ownerId, attendeeId], +range.from, +range.to, organizationId, signal)
  expect(getStaffAvailabilityWindows(data, organizationId, ownerId)).toEqual([])
  expect(getStaffAvailabilityWindows(data, organizationId, attendeeId)).toBeUndefined()
  expect(getStaffAvailabilityWindows(data, secondOrganizationId, ownerId)).toBeUndefined()
  expect(getStaffAvailabilityWindows(data, null, ownerId)).toBeUndefined()
  expect(call).toHaveBeenCalledWith(expect.stringContaining(`organizationId=${organizationId}`), { signal })
})

test('uses half-open overlap, tenant-local identity and deduplicated conflict descriptions', async () => {
  respond([
    { userId: ownerId, organizationId, windows: [leave, leave] },
    { userId: attendeeId, organizationId: secondOrganizationId, windows: [leave] },
  ])
  const data = await loadStaffAvailability([ownerId, attendeeId], +range.from, +range.to, null, signal)
  const people = [{ userId: ownerId, label: 'Owner' }, { userId: attendeeId, label: 'Attendee' }]
  expect(findStaffAvailabilityConflicts(data, range, organizationId, people)).toEqual([
    { userId: ownerId, label: 'Owner', kind: 'leave', reason: 'Time off' },
  ])
  const following = { from: range.to, to: new Date('2026-11-22T13:00:00.000Z') }
  expect(findStaffAvailabilityConflicts(data, following, organizationId, people)).toEqual([])
})

test('checks the whole long span and keeps a missing optional route silent', async () => {
  respond([{ userId: ownerId, organizationId, windows: [leave] }])
  call.mockResolvedValueOnce({ ok: false, status: 404 } as Awaited<ReturnType<typeof apiCall>>)
  expect(await loadStaffAvailability([ownerId], +range.from, +range.to, null, signal)).toEqual(new Map())

  const longEnd = new Date('2027-03-01T11:00:00.000Z')
  call.mockClear()
  const data = await loadStaffAvailability([ownerId], +range.from, +longEnd, null, signal)
  expect(call).toHaveBeenCalledTimes(2)
  expect(getStaffAvailabilityWindows(data, organizationId, ownerId)).toHaveLength(2)
  expect(staffAvailabilityUserIds([ownerId.toUpperCase(), '', ownerId, attendeeId])).toEqual([ownerId, attendeeId])
})

test('mine keeps an event involving the viewer and checks the other attendee', async () => {
  const item = mapInteractionToCalendarItem({
    id: 'event',
    organizationId,
    interactionType: 'meeting',
    status: 'planned',
    scheduledAt: range.from.toISOString(),
    ownerUserId: ownerId,
    participants: [{ userId: attendeeId, name: 'Attendee' }, { email: 'guest@example.test' }],
  }, {})!
  expect(calendarStaffAvailabilityCandidates([item], 'mine', secondOrganizationId)).toEqual([])
  expect(calendarStaffAvailabilityCandidates([item], 'all', secondOrganizationId)).toHaveLength(1)
  const [candidate] = calendarStaffAvailabilityCandidates([item], 'mine', ownerId)
  respond([{ userId: attendeeId, organizationId, windows: [leave] }])
  const data = await loadStaffAvailability([ownerId, attendeeId], +range.from, +range.to, null, signal)
  expect(findStaffAvailabilityConflicts(data, range, candidate.organizationId, candidate.people)).toEqual([
    { userId: attendeeId, label: 'Attendee', kind: 'leave', reason: 'Time off' },
  ])
})
