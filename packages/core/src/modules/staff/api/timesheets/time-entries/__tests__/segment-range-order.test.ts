/** @jest-environment node */
import { StaffTimeEntry, StaffTimeEntrySegment } from '@open-mercato/core/modules/staff/data/entities'
import { runStaffMutationGuards } from '@open-mercato/core/modules/staff/api/guards'

const TENANT_ID = '44444444-4444-4444-8444-444444444444'
const ORG_ID = '55555555-5555-4555-8555-555555555555'
const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const SEGMENT_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const ERROR_KEY = 'staff.timesheets.errors.segmentEndBeforeStart'

const mockFindOneWithDecryption = jest.fn()
const mockEmitStaffEvent = jest.fn(async () => undefined)
const mockEm: Record<string, jest.Mock> = {
  fork: jest.fn(),
  flush: jest.fn(async () => undefined),
  create: jest.fn((_cls: unknown, data: Record<string, unknown>) => ({ id: SEGMENT_ID, ...data })),
  transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(mockEm)),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'em' ? mockEm : null),
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID, roles: ['admin'] })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ tenantId: TENANT_ID, selectedId: ORG_ID, filterIds: [ORG_ID] })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string) => key })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/lib/staffMemberResolver', () => ({
  getStaffMemberByUserId: jest.fn(async () => ({ id: STAFF_MEMBER_ID })),
}))

jest.mock('@open-mercato/core/modules/staff/api/guards', () => ({
  ...jest.requireActual('@open-mercato/core/modules/staff/api/guards'),
  runStaffMutationGuards: jest.fn(async () => ({ ok: true, afterSuccessCallbacks: [] })),
  runStaffMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn(() => mockEmitStaffEvent()),
}))

type SegmentRow = {
  id: string
  timeEntryId: string
  tenantId: string
  organizationId: string
  startedAt: Date
  endedAt: Date | null
  segmentType: 'work' | 'break'
}

let segmentRow: SegmentRow

function makeSegment(startedAt: string, endedAt: string | null): SegmentRow {
  return {
    id: SEGMENT_ID,
    timeEntryId: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    startedAt: new Date(startedAt),
    endedAt: endedAt ? new Date(endedAt) : null,
    segmentType: 'work',
  }
}

function jsonRequest(method: string, path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost/api/staff/timesheets/time-entries/${ENTRY_ID}/segments${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await import('../[id]/segments/[segmentId]/route')
  const res = await PATCH(jsonRequest('PATCH', `/${SEGMENT_ID}`, body))
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('../[id]/segments/route')
  const res = await POST(jsonRequest('POST', '', body))
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEm.fork.mockReturnValue(mockEm)
  segmentRow = makeSegment('2026-01-01T08:00:00.000Z', '2026-01-01T10:00:00.000Z')
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, cls: unknown) => {
    if (cls === StaffTimeEntry) {
      return { id: ENTRY_ID, tenantId: TENANT_ID, organizationId: ORG_ID, staffMemberId: STAFF_MEMBER_ID }
    }
    if (cls === StaffTimeEntrySegment) return segmentRow
    return null
  })
})

describe('time entry segments never end before they start', () => {
  test.each([
    ['an endedAt earlier than the stored startedAt', { endedAt: '2026-01-01T07:00:00.000Z' }, 'endedAt'],
    ['a startedAt later than the stored endedAt', { startedAt: '2026-01-01T11:00:00.000Z' }, 'startedAt'],
    ['both ends reversed', { startedAt: '2026-01-01T12:00:00.000Z', endedAt: '2026-01-01T11:00:00.000Z' }, 'endedAt'],
  ])('PATCH refuses %s', async (_label, body, field) => {
    const { status, json } = await patch(body)

    expect(status).toBe(400)
    expect(json).toEqual({ code: 'segment_end_before_start', error: ERROR_KEY, fieldErrors: { [field]: ERROR_KEY } })
    expect(mockEm.flush).not.toHaveBeenCalled()
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })

  test('PATCH accepts ordered, zero-length and open segments', async () => {
    expect((await patch({ endedAt: '2026-01-01T11:00:00.000Z' })).status).toBe(200)
    expect(segmentRow.endedAt?.toISOString()).toBe('2026-01-01T11:00:00.000Z')

    segmentRow = makeSegment('2026-01-01T08:00:00.000Z', '2026-01-01T11:00:00.000Z')
    expect((await patch({ startedAt: '2026-01-01T11:00:00.000Z' })).status).toBe(200)

    segmentRow = makeSegment('2026-01-01T08:00:00.000Z', null)
    expect((await patch({ startedAt: '2026-01-01T09:00:00.000Z' })).status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalledTimes(3)
  })

  test('PATCH still lets a segmentType-only edit through on a segment stored with reversed ends', async () => {
    segmentRow = makeSegment('2026-01-01T10:00:00.000Z', '2026-01-01T08:00:00.000Z')

    expect((await patch({ segmentType: 'break' })).status).toBe(200)
    expect(segmentRow.segmentType).toBe('break')
  })

  test('POST refuses a body with reversed ends', async () => {
    const { status, json } = await post({ startedAt: '2026-01-01T12:00:00.000Z', endedAt: '2026-01-01T11:00:00.000Z' })

    expect(status).toBe(400)
    expect(json).toEqual({ code: 'segment_end_before_start', error: ERROR_KEY, fieldErrors: { endedAt: ERROR_KEY } })
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(jest.mocked(runStaffMutationGuards)).not.toHaveBeenCalled()
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })

  test('POST accepts an ordered or open segment', async () => {
    expect((await post({ startedAt: '2026-01-01T08:00:00.000Z', endedAt: '2026-01-01T10:00:00.000Z' })).status).toBe(201)
    expect((await post({ startedAt: '2026-01-01T08:00:00.000Z' })).status).toBe(201)
    expect(mockEm.create).toHaveBeenCalledTimes(2)
  })
})
