/** @jest-environment node */
import { StaffTimeEntry, StaffTimeEntrySegment } from '@open-mercato/core/modules/staff/data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockGetStaffMemberByUserId = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockEmitStaffEvent = jest.fn()

let flushCount = 0

const mockEm: Record<string, jest.Mock> = {
  fork: jest.fn(),
  flush: jest.fn(async () => {
    flushCount += 1
  }),
  transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(mockEm)),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'em' ? mockEm : null),
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId: 'tenant-1',
    orgId: 'org-1',
    roles: ['admin'],
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId: 'tenant-1',
    selectedId: 'org-1',
    filterIds: ['org-1'],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string) => key,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/lib/staffMemberResolver', () => ({
  getStaffMemberByUserId: jest.fn((...args: unknown[]) => mockGetStaffMemberByUserId(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/api/guards', () => ({
  ...jest.requireActual('@open-mercato/core/modules/staff/api/guards'),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn((...args: unknown[]) => mockEmitStaffEvent(...args)),
}))

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const SEGMENT_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'

type SegmentRow = {
  id: string
  timeEntryId: string
  tenantId: string
  organizationId: string
  startedAt: Date
  endedAt: Date | null
  segmentType: 'work' | 'break'
  createdAt: Date
  updatedAt: Date
}

let segmentRow: SegmentRow

function makeSegment(startedAt: string, endedAt: string | null): SegmentRow {
  return {
    id: SEGMENT_ID,
    timeEntryId: ENTRY_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    startedAt: new Date(startedAt),
    endedAt: endedAt ? new Date(endedAt) : null,
    segmentType: 'work',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

function patchRequest(body: Record<string, unknown>) {
  return new Request(
    `http://localhost/api/staff/timesheets/time-entries/${ENTRY_ID}/segments/${SEGMENT_ID}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await import('../[id]/segments/[segmentId]/route')
  const res = await PATCH(patchRequest(body))
  const json = (await res.json()) as Record<string, unknown>
  return { status: res.status, json }
}

beforeEach(() => {
  jest.clearAllMocks()
  flushCount = 0
  mockEm.fork.mockReturnValue(mockEm)
  mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
  mockEmitStaffEvent.mockResolvedValue(undefined)
  segmentRow = makeSegment('2026-01-01T08:00:00.000Z', '2026-01-01T10:00:00.000Z')
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, cls: unknown) => {
    if (cls === StaffTimeEntry) {
      return { id: ENTRY_ID, tenantId: 'tenant-1', organizationId: 'org-1', staffMemberId: STAFF_MEMBER_ID }
    }
    if (cls === StaffTimeEntrySegment) return segmentRow
    return null
  })
})

describe('segment PATCH keeps endedAt at or after startedAt', () => {
  test('refuses an endedAt earlier than the stored startedAt', async () => {
    const { status, json } = await patch({ endedAt: '2026-01-01T07:00:00.000Z' })

    expect(status).toBe(400)
    expect(json.code).toBe('segment_end_before_start')
    expect(json.error).toBe('staff.timesheets.errors.segmentEndBeforeStart')
    expect(json.fieldErrors).toEqual({ endedAt: 'staff.timesheets.errors.segmentEndBeforeStart' })
    expect(flushCount).toBe(0)
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })

  test('refuses a startedAt later than the stored endedAt', async () => {
    const { status, json } = await patch({ startedAt: '2026-01-01T11:00:00.000Z' })

    expect(status).toBe(400)
    expect(json.fieldErrors).toEqual({ startedAt: 'staff.timesheets.errors.segmentEndBeforeStart' })
    expect(flushCount).toBe(0)
  })

  test('refuses a body that sends both ends reversed', async () => {
    const { status, json } = await patch({
      startedAt: '2026-01-01T12:00:00.000Z',
      endedAt: '2026-01-01T11:00:00.000Z',
    })

    expect(status).toBe(400)
    expect(json.fieldErrors).toEqual({ endedAt: 'staff.timesheets.errors.segmentEndBeforeStart' })
    expect(flushCount).toBe(0)
  })

  test('accepts an ordered change and a zero-length segment', async () => {
    const forward = await patch({ endedAt: '2026-01-01T11:00:00.000Z' })
    expect(forward.status).toBe(200)
    expect(segmentRow.endedAt?.toISOString()).toBe('2026-01-01T11:00:00.000Z')

    const zeroLength = await patch({ startedAt: '2026-01-01T11:00:00.000Z' })
    expect(zeroLength.status).toBe(200)
    expect(flushCount).toBe(2)
  })

  test('leaves an open segment and segmentType-only edits alone', async () => {
    segmentRow = makeSegment('2026-01-01T08:00:00.000Z', null)
    const openSegment = await patch({ startedAt: '2026-01-01T09:00:00.000Z' })
    expect(openSegment.status).toBe(200)

    segmentRow = makeSegment('2026-01-01T10:00:00.000Z', '2026-01-01T08:00:00.000Z')
    const typeOnly = await patch({ segmentType: 'break' })
    expect(typeOnly.status).toBe(200)
    expect(flushCount).toBe(2)
  })
})
