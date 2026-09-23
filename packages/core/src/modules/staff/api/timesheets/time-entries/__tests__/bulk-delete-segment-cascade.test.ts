/** @jest-environment node */
// The weekly-grid bulk save soft-deletes an entry by zeroing its duration, which
// carries the same cascade obligation as `time_entries.delete`: the route filters
// candidates by staff member and `deletedAt: null` but NOT by `source`, so a
// timer-created entry that owns segments is eligible. Before the cascade, zeroing
// such a cell left every segment live under a deleted parent — and an open one
// still reading as running.
//
// This pins the forward cascade only. The route has no undo handler, so there is
// no recorded instant to restore from.
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockInvalidateCache = jest.fn()

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const ENTRY_ID = '44444444-4444-4444-8444-444444444444'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    features: ['staff.timesheets.manage_own'],
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId: TENANT_ID,
    selectedId: ORG_ID,
    filterIds: [ORG_ID],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
  flushCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/staff/lib/timesheets/timeEntryCacheInvalidation', () => ({
  invalidateStaffTimeEntryCache: jest.fn((...args: unknown[]) => mockInvalidateCache(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/api/guards', () => ({
  ...jest.requireActual('@open-mercato/core/modules/staff/api/guards'),
  runStaffMutationGuards: jest.fn(async () => ({ ok: true, afterSuccessCallbacks: [] })),
  runStaffMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

type SegmentRow = {
  id: string
  tenantId: string
  organizationId: string
  timeEntryId: string
  startedAt: Date
  endedAt: Date | null
  deletedAt: Date | null
}

function makeSegment(overrides: Partial<SegmentRow> & { id: string }): SegmentRow {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeEntryId: ENTRY_ID,
    startedAt: new Date('2026-08-26T09:00:00.000Z'),
    endedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

const entry = {
  id: ENTRY_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  staffMemberId: STAFF_MEMBER_ID,
  date: new Date('2026-08-26T00:00:00.000Z'),
  durationMinutes: 60,
  startedAt: new Date('2026-08-26T09:00:00.000Z'),
  endedAt: null,
  notes: null,
  timeProjectId: PROJECT_ID,
  deletedAt: null as Date | null,
  updatedAt: new Date(),
}

let segments: SegmentRow[] = []

function makeEm() {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    // The route pre-validates entry ownership with `em.find`, and resolves valid
    // projects with it too; the entry query is the one carrying `staffMemberId`.
    find: jest.fn(async (_cls: unknown, where: Record<string, unknown> = {}) => {
      // The report-lock pre-flight asks for entries that ARE frozen and also
      // carries `staffMemberId`; this fixture's entry is not locked, so that probe
      // must come back empty or the save is refused with 409 `time_entry_locked`.
      if ('lockedReportId' in where) return []
      if ('staffMemberId' in where) return [entry]
      return [{ id: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID }]
    }),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (fn: (trx: unknown) => Promise<unknown>) => fn(em)),
  }
  em.fork.mockReturnValue(em)
  return em
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return (globalThis as Record<string, unknown>).__testEm
      if (token === 'dataEngine') return {}
      return null
    },
  })),
}))

function bulkRequest(durationMinutes: number) {
  return new Request('http://localhost/api/staff/timesheets/time-entries/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      entries: [
        {
          id: ENTRY_ID,
          date: '2026-08-26',
          timeProjectId: PROJECT_ID,
          durationMinutes,
          notes: null,
        },
      ],
    }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  entry.deletedAt = null
  const em = makeEm()
  ;(globalThis as Record<string, unknown>).__testEm = em

  mockFindOneWithDecryption.mockResolvedValue({ id: STAFF_MEMBER_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
  mockFindWithDecryption.mockImplementation(async (_em, entityRef, where: Record<string, unknown>) => {
    // The segment cascade is the only caller that filters on `timeEntryId`.
    if ('timeEntryId' in where) {
      return segments.filter((row) =>
        Object.entries(where).every(([field, expected]) => {
          const actual = (row as unknown as Record<string, unknown>)[field]
          if (expected === null) return actual === null
          return actual === expected
        }),
      )
    }
    return [entry]
  })
})

describe('bulk save: zeroing an entry cascades to its segments', () => {
  test('soft-deletes every live segment on the same instant as the entry', async () => {
    const open = makeSegment({ id: 'seg-a' })
    const closed = makeSegment({ id: 'seg-b', endedAt: new Date('2026-08-26T10:00:00.000Z') })
    segments = [open, closed]

    const { POST } = await import('../bulk/route')
    const res = await POST(bulkRequest(0))
    expect(res.status).toBe(200)

    expect(entry.deletedAt).toBeInstanceOf(Date)
    expect(open.deletedAt).toBe(entry.deletedAt)
    expect(closed.deletedAt).toBe(entry.deletedAt)
    expect(open.endedAt).toBe(entry.deletedAt)
  })

  test('never touches a segment belonging to another organization', async () => {
    const inScope = makeSegment({ id: 'seg-a' })
    const foreign = makeSegment({ id: 'seg-b', organizationId: OTHER_ORG_ID })
    segments = [inScope, foreign]

    const { POST } = await import('../bulk/route')
    await POST(bulkRequest(0))

    expect(inScope.deletedAt).toBe(entry.deletedAt)
    expect(foreign.deletedAt).toBeNull()
  })

  test('leaves segments alone when the entry is updated rather than zeroed', async () => {
    const open = makeSegment({ id: 'seg-a' })
    segments = [open]

    const { POST } = await import('../bulk/route')
    await POST(bulkRequest(45))

    expect(entry.deletedAt).toBeNull()
    expect(open.deletedAt).toBeNull()
  })
})
