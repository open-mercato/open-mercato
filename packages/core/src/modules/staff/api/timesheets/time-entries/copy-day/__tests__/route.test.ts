/** @jest-environment node */
// T4.4 — `POST …/time-entries/copy-day` ("Kopiuj wczorajszy dzień", screen 1 n5).
//
// Three route decisions are pinned here, because they are the ones a later change
// could quietly reverse:
//
//  * a LOCKED SOURCE is skipped and reported, not fatal — the copy never writes to
//    the locked row, unlike the grid bulk save where the locked rows are the ones
//    being written and the whole batch must fail;
//  * a second call does NOT double the day: a non-empty target is refused with
//    `409 copy_day_target_not_empty` unless `allowDuplicates: true` is sent;
//  * the response carries the created rows, because note 5 calls them "versions to
//    correct" — a count would leave the UI unable to show them.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()
const mockGetGrantedFeatures = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockResolveProjectAccess = jest.fn()
const mockEmFind = jest.fn()

const mockEm = {
  fork: jest.fn(() => mockEm),
  find: jest.fn((...args: unknown[]) => mockEmFind(...args)),
  findOne: jest.fn(async () => null),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'rbacService') return { getGrantedFeatures: mockGetGrantedFeatures }
    if (token === 'em') return mockEm
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn((args: unknown) => mockRunRouteMutationGuards(args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn(async () => null),
}))

jest.mock('../../../../../lib/time-tracking/access', () => {
  const actual = jest.requireActual('../../../../../lib/time-tracking/access')
  return {
    ...actual,
    resolveProjectAccess: jest.fn((...args: unknown[]) => mockResolveProjectAccess(...args)),
  }
})

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '11111111-1111-4111-8111-1111111111ff'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_STAFF_MEMBER_ID = '44444444-4444-4444-8444-4444444444ff'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const HIDDEN_PROJECT_ID = '55555555-5555-4555-8555-5555555555ff'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const ENTRY_A = '77777777-7777-4777-8777-77777777000a'
const ENTRY_B = '77777777-7777-4777-8777-77777777000b'
const ENTRY_C = '77777777-7777-4777-8777-77777777000c'
const EXISTING_ID = '77777777-7777-4777-8777-7777777700ee'
const REPORT_ID = '99999999-9999-4999-8999-999999999999'
const TAG_ONE = '88888888-8888-4888-8888-000000000001'
const MANAGE_OWN = 'staff.timesheets.manage_own'
const MANAGE_ALL = 'staff.timesheets.manage_all'

const FROM_DATE = '2026-07-01'
const TO_DATE = '2026-07-02'

type EntryRow = Record<string, unknown> & { id: string }

let entities: typeof import('../../../../../data/entities')
type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

/** Rows the fake `findWithDecryption` answers the source-day query with. */
let sourceRows: EntryRow[] = []
/** Rows the fake `em.find` answers the target-day emptiness probe with. */
let targetDayRows: { id: string }[] = []
/** Tag junction rows the fake `em.find` answers with. */
let tagRows: { timeEntryId: string; tagId: string }[] = []

beforeAll(async () => {
  entities = await import('../../../../../data/entities')
  postHandler = (await import('../route')).POST
})

function entryRow(id: string, overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: new Date(`${FROM_DATE}T00:00:00.000Z`),
    durationMinutes: 90,
    roundedMinutes: 90,
    notes: `note ${id}`,
    timeProjectId: PROJECT_ID,
    taskId: TASK_ID,
    isBillable: true,
    lockedReportId: null,
    deletedAt: null,
    ...overrides,
  }
}

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/staff/timesheets/time-entries/copy-day', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function copiedIdFor(sourceId: string): string {
  return `${sourceId.slice(0, -1)}9`
}

describe('staff timesheets copy-day route (T4.4 / US-D6, screen 1 note 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    sourceRows = [entryRow(ENTRY_A), entryRow(ENTRY_B)]
    targetDayRows = []
    tagRows = [{ timeEntryId: ENTRY_A, tagId: TAG_ONE }]

    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      features: [MANAGE_OWN],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: TENANT_ID, selectedId: ORG_ID, filterIds: [ORG_ID] })
    mockGetGrantedFeatures.mockResolvedValue([MANAGE_OWN])
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
    mockResolveProjectAccess.mockResolvedValue({
      canManageAll: false,
      projectIds: [PROJECT_ID],
      staffMemberId: STAFF_MEMBER_ID,
    })

    // The source-day read and the created-rows read share one helper; they are
    // told apart by the shape of the where clause, as the route builds them.
    mockFindWithDecryption.mockImplementation(async (_em: unknown, _cls: unknown, where: Record<string, unknown>) => {
      const idFilter = where.id as { $in?: string[] } | undefined
      if (idFilter?.$in) {
        return idFilter.$in.map((id) => entryRow(id, { date: new Date(`${TO_DATE}T00:00:00.000Z`), roundedMinutes: 90 }))
      }
      return sourceRows.filter(
        (row) =>
          row.tenantId === where.tenantId &&
          row.organizationId === where.organizationId &&
          row.staffMemberId === where.staffMemberId,
      )
    })

    mockEmFind.mockImplementation(async (cls: unknown, where: Record<string, unknown>) => {
      if (cls === entities.StaffTimeEntryTag) {
        const wanted = (where.timeEntryId as { $in: string[] }).$in
        return tagRows.filter((row) => wanted.includes(row.timeEntryId))
      }
      if (cls === entities.StaffTimeEntry) return targetDayRows
      return []
    })

    mockExecute.mockImplementation(async (_commandId: string, opts: { input: { id: string } }) => ({
      result: { timeEntryId: copiedIdFor(opts.input.id) },
      logEntry: null,
    }))
  })

  it('copies a full day and answers with the created rows, not a count', async () => {
    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, fromDate: FROM_DATE, toDate: TO_DATE, copied: 2, skipped: [] })
    expect(body.created).toHaveLength(2)
    expect(body.created[0]).toMatchObject({
      id: copiedIdFor(ENTRY_A),
      sourceId: ENTRY_A,
      date: TO_DATE,
      durationMinutes: 90,
      timeProjectId: PROJECT_ID,
      taskId: TASK_ID,
      isBillable: true,
      tagIds: [TAG_ONE],
    })
    expect(mockExecute).toHaveBeenCalledTimes(2)
    expect(mockExecute.mock.calls.every((call) => call[0] === 'staff.timesheets.time_entries.duplicate')).toBe(true)
    expect(mockRunAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('reuses the duplicate command for every source, moving each copy onto the target day with its tags', async () => {
    await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    const inputs = mockExecute.mock.calls.map((call) => call[1].input as Record<string, unknown>)
    expect(inputs.map((input) => input.id)).toEqual([ENTRY_A, ENTRY_B])
    for (const input of inputs) {
      expect((input.date as Date).toISOString().slice(0, 10)).toBe(TO_DATE)
    }
    expect(inputs[0].tagIds).toEqual([TAG_ONE])
    expect(inputs[1].tagIds).toEqual([])
  })

  it('reports rounded_minutes on every copy (D-7)', async () => {
    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))
    const body = await response.json()

    for (const created of body.created) {
      expect(created.roundedMinutes).not.toBeNull()
      expect(typeof created.roundedMinutes).toBe('number')
    }
  })

  it('skips a LOCKED source, reports it with the shared code, and still copies the rest', async () => {
    sourceRows = [entryRow(ENTRY_A), entryRow(ENTRY_B, { lockedReportId: REPORT_ID })]

    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.copied).toBe(1)
    expect(body.created.map((row: { sourceId: string }) => row.sourceId)).toEqual([ENTRY_A])
    expect(body.skipped).toEqual([
      { id: ENTRY_B, reason: 'time_entry_locked', lockedReportId: REPORT_ID, error: null },
    ])
    // The locked source is never handed to the command, so its numbers are never
    // even read for a write.
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockExecute.mock.calls[0][1].input.id).toBe(ENTRY_A)
  })

  it('refuses a second call rather than silently doubling the day', async () => {
    const first = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))
    expect(first.status).toBe(200)

    // The first run left the target day occupied; the second call sees that.
    targetDayRows = [{ id: EXISTING_ID }]
    jest.clearAllMocks()
    mockExecute.mockImplementation(async (_id: string, opts: { input: { id: string } }) => ({
      result: { timeEntryId: copiedIdFor(opts.input.id) },
      logEntry: null,
    }))

    const second = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toMatchObject({
      code: 'copy_day_target_not_empty',
      toDate: TO_DATE,
      existingEntryCount: 1,
      existingEntryIds: [EXISTING_ID],
    })
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunRouteMutationGuards).not.toHaveBeenCalled()
  })

  it('copies onto a non-empty day when the caller opts in with allowDuplicates', async () => {
    targetDayRows = [{ id: EXISTING_ID }]

    const response = await postHandler(
      buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE, allowDuplicates: true }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ copied: 2 })
    expect(mockExecute).toHaveBeenCalledTimes(2)
  })

  it('refuses copying a day onto itself', async () => {
    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: FROM_DATE }))

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('answers an empty source day with an empty report rather than an error', async () => {
    sourceRows = []
    targetDayRows = [{ id: EXISTING_ID }]

    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ copied: 0, created: [], skipped: [] })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('leaves out sources on projects the caller cannot see', async () => {
    sourceRows = [
      entryRow(ENTRY_A),
      entryRow(ENTRY_B, { timeProjectId: HIDDEN_PROJECT_ID }),
      entryRow(ENTRY_C, { timeProjectId: null, staffMemberId: STAFF_MEMBER_ID }),
    ]

    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))
    const body = await response.json()

    expect(body.created.map((row: { sourceId: string }) => row.sourceId)).toEqual([ENTRY_A, ENTRY_C])
    expect(JSON.stringify(body)).not.toContain(HIDDEN_PROJECT_ID)
    expect(mockExecute).toHaveBeenCalledTimes(2)
  })

  it('scopes the source query by tenant, organization, staff member and day', async () => {
    await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    const where = mockFindWithDecryption.mock.calls[0][2] as Record<string, unknown>
    expect(where).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      staffMemberId: STAFF_MEMBER_ID,
      deletedAt: null,
    })
    expect((where.date as Date).toISOString().slice(0, 10)).toBe(FROM_DATE)
    expect(mockFindWithDecryption.mock.calls[0][4]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it("does not copy another tenant's entries even when they land in the source read", async () => {
    sourceRows = [entryRow(ENTRY_A), entryRow(ENTRY_B, { tenantId: OTHER_TENANT_ID })]

    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))
    const body = await response.json()

    expect(body.created.map((row: { sourceId: string }) => row.sourceId)).toEqual([ENTRY_A])
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it("refuses another member's day without staff.timesheets.manage_all", async () => {
    const response = await postHandler(
      buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE, staffMemberId: OTHER_STAFF_MEMBER_ID }),
    )

    expect(response.status).toBe(403)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it("allows another member's day for a staff.timesheets.manage_all holder", async () => {
    mockGetGrantedFeatures.mockResolvedValue([MANAGE_OWN, MANAGE_ALL])
    mockResolveProjectAccess.mockResolvedValue({
      canManageAll: true,
      projectIds: [],
      staffMemberId: STAFF_MEMBER_ID,
    })
    sourceRows = [entryRow(ENTRY_A, { staffMemberId: OTHER_STAFF_MEMBER_ID })]

    const response = await postHandler(
      buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE, staffMemberId: OTHER_STAFF_MEMBER_ID }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ copied: 1, staffMemberId: OTHER_STAFF_MEMBER_ID })
  })

  it('reports a source that fails to copy instead of discarding the copies that landed', async () => {
    const { CrudHttpError } = await import('@open-mercato/shared/lib/crud/errors')
    mockExecute.mockImplementation(async (_commandId: string, opts: { input: { id: string } }) => {
      if (opts.input.id === ENTRY_B) {
        throw new CrudHttpError(422, { error: 'Time project not found or not accessible.' })
      }
      return { result: { timeEntryId: copiedIdFor(opts.input.id) }, logEntry: null }
    })

    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.copied).toBe(1)
    expect(body.skipped).toEqual([
      {
        id: ENTRY_B,
        reason: 'copy_failed',
        lockedReportId: null,
        error: 'Time project not found or not accessible.',
      },
    ])
  })

  it('wires the mutation guard registry and stops on a blocked mutation', async () => {
    const blocked = Response.json({ error: 'Blocked' }, { status: 423 })
    mockRunRouteMutationGuards.mockResolvedValueOnce({ ok: false, response: blocked })

    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    expect(response.status).toBe(423)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(
      expect.objectContaining({
        container: mockContainer,
        auth: expect.objectContaining({
          userId: 'user-1',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          userFeatures: [MANAGE_OWN],
        }),
        input: expect.objectContaining({
          resourceKind: 'staff.timesheets.time_entry',
          resourceId: STAFF_MEMBER_ID,
          operation: 'create',
        }),
      }),
    )
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects a caller without staff.timesheets.manage_own with 403', async () => {
    mockGetGrantedFeatures.mockResolvedValue(['staff.timesheets.view'])

    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    expect(response.status).toBe(403)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller with 401', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await postHandler(buildRequest({ fromDate: FROM_DATE, toDate: TO_DATE }))

    expect(response.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects a body without both days with 400', async () => {
    const response = await postHandler(buildRequest({ fromDate: FROM_DATE }))

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
