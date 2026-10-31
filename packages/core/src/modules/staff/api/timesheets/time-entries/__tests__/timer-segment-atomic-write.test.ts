/** @jest-environment node */
// Regression coverage for issue #2416: the timer/segment write endpoints must
// perform their read-modify-write inside a single transaction with a
// PESSIMISTIC_WRITE lock on the StaffTimeEntry row so concurrent requests on the
// same entry serialize instead of racing on a shared in-memory snapshot.
import { LockMode } from '@mikro-orm/core'
import { StaffTimeEntry, StaffTimeEntrySegment } from '@open-mercato/core/modules/staff/data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockGetStaffMemberByUserId = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunStaffMutationGuardAfterSuccess = jest.fn()
const mockEmitStaffEvent = jest.fn()
const mockParseScopedCommandInput = jest.fn()

const findOneOptions: Array<Record<string, unknown>> = []
let transactionalCalls = 0
let lastTrxFlushCount = 0

const mockEm: Record<string, jest.Mock> = {
  fork: jest.fn(),
  create: jest.fn((_cls: unknown, data: Record<string, unknown>) => ({
    id: 'segment-created',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...data,
  })),
  flush: jest.fn(async () => {
    lastTrxFlushCount += 1
  }),
  transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => {
    transactionalCalls += 1
    return callback(mockEm)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      return null
    },
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
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/lib/staffMemberResolver', () => ({
  getStaffMemberByUserId: jest.fn((...args: unknown[]) => mockGetStaffMemberByUserId(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/api/guards', () => ({
  ...jest.requireActual('@open-mercato/core/modules/staff/api/guards'),
  resolveUserFeatures: jest.fn(() => ['staff.timesheets.manage_own']),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) =>
    mockRunStaffMutationGuardAfterSuccess(...args),
  ),
}))

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn((...args: unknown[]) => mockEmitStaffEvent(...args)),
}))

jest.mock('@open-mercato/shared/lib/api/scoped', () => ({
  parseScopedCommandInput: jest.fn((...args: unknown[]) => mockParseScopedCommandInput(...args)),
}))

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const SEGMENT_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    staffMemberId: STAFF_MEMBER_ID,
    startedAt: null,
    endedAt: null,
    durationMinutes: 0,
    source: 'manual',
    ...overrides,
  }
}

function lockOptionWasUsed() {
  return findOneOptions.some((opt) => opt && opt.lockMode === LockMode.PESSIMISTIC_WRITE)
}

beforeEach(() => {
  jest.clearAllMocks()
  findOneOptions.length = 0
  transactionalCalls = 0
  lastTrxFlushCount = 0
  mockEm.fork.mockReturnValue(mockEm)
  mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
  mockRunStaffMutationGuardAfterSuccess.mockResolvedValue(undefined)
  mockEmitStaffEvent.mockResolvedValue(undefined)
  mockFindOneWithDecryption.mockImplementation(async (_em, _cls, _where, opts) => {
    if (opts) findOneOptions.push(opts)
    return null
  })
  mockFindWithDecryption.mockResolvedValue([])
})

// The #2416 lock coverage for both timer endpoints now lives beside the
// transactions themselves, in `commands/__tests__/timesheets-stop-timer.test.ts`
// and `commands/__tests__/timesheets-start-timer-existing.test.ts`. Both routes
// delegate to their commands (`…stop_timer` / `…start_timer_existing`) and no
// longer touch the ORM, so route-level lock assertions would prove nothing about
// locking. Their own contracts are covered by `timer-stop-route-delegation.test.ts`
// and `timer-start-route-delegation.test.ts`.

describe('segment create atomic write (#2416)', () => {
  function request() {
    return new Request(`http://localhost/api/staff/timesheets/time-entries/${ENTRY_ID}/segments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startedAt: '2026-01-01T08:00:00.000Z', segmentType: 'work' }),
    })
  }

  test('creates the segment inside a transaction that locks the parent entry', async () => {
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, _where, opts) => {
      if (opts) findOneOptions.push(opts)
      return makeEntry()
    })
    mockParseScopedCommandInput.mockReturnValue({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      timeEntryId: ENTRY_ID,
      startedAt: new Date('2026-01-01T08:00:00.000Z'),
      endedAt: null,
      segmentType: 'work',
    })

    const { POST } = await import('../[id]/segments/route')
    const res = await POST(request())

    expect(res.status).toBe(201)
    expect(transactionalCalls).toBe(1)
    expect(lockOptionWasUsed()).toBe(true)
    expect(mockEm.create).toHaveBeenCalledWith(StaffTimeEntrySegment, expect.objectContaining({
      timeEntryId: ENTRY_ID,
    }))
    expect(lastTrxFlushCount).toBe(1)
  })
})

describe('segment edit atomic write (#2416)', () => {
  function request() {
    return new Request(
      `http://localhost/api/staff/timesheets/time-entries/${ENTRY_ID}/segments/${SEGMENT_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segmentType: 'break' }),
      },
    )
  }

  test('updates the segment inside a transaction that locks the parent entry', async () => {
    mockFindOneWithDecryption.mockImplementation(async (_em, cls, _where, opts) => {
      if (opts) findOneOptions.push(opts)
      if (cls === StaffTimeEntry) return makeEntry()
      if (cls === StaffTimeEntrySegment) {
        return {
          id: SEGMENT_ID,
          timeEntryId: ENTRY_ID,
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          startedAt: new Date('2026-01-01T08:00:00.000Z'),
          endedAt: null,
          segmentType: 'work',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }
      }
      return null
    })

    const { PATCH } = await import('../[id]/segments/[segmentId]/route')
    const res = await PATCH(request())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect((body.item as Record<string, unknown>).segmentType).toBe('break')
    expect(transactionalCalls).toBe(1)
    expect(lockOptionWasUsed()).toBe(true)
    expect(lastTrxFlushCount).toBe(1)
  })
})
