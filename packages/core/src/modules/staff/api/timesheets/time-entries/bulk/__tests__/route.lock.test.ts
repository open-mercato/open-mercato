/** @jest-environment node */
// T4.2 / TC-TT-018 — the grid bulk save, which risk R3 names as the likeliest
// side door into a locked entry: it addresses a cell by (project, date) and only
// carries an id when the client had one loaded. Both shapes are refused here,
// and the batch fails wholesale so the client is never left guessing which of a
// week's cells landed.
//
// It also pins the rounding hole T4.1 found: this route writes durations outside
// the entries command, and D-7 makes `rounded_minutes` the only input to cost.

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-4444444444ff'
const LOCKED_ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const FREE_ENTRY_ID = '55555555-5555-4555-8555-5555555555ff'
const CREATED_ENTRY_ID = '66666666-6666-4666-8666-666666666666'
const REPORT_ID = '99999999-9999-4999-8999-999999999999'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunStaffMutationGuardAfterSuccess = jest.fn()
const mockEntityManagerFind = jest.fn()
const mockTrxCreate = jest.fn()
const mockTrxFlush = jest.fn()

const settingsStore: Record<string, unknown> = {}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return { fork: () => forkedEntityManager }
    if (token === 'dataEngine') return { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn() }
    if (token === 'cache') return { get: jest.fn(), set: jest.fn(), deleteByTags: jest.fn() }
    if (token === 'moduleConfigService') {
      return {
        getRecord: async (_moduleId: string, name: string) =>
          Object.prototype.hasOwnProperty.call(settingsStore, name) ? { value: settingsStore[name] } : null,
      }
    }
    return undefined
  }),
}

const forkedEntityManager = {
  find: (...args: unknown[]) => mockEntityManagerFind(...args),
  transactional: async (callback: (trx: unknown) => unknown) =>
    callback({
      create: (...args: unknown[]) => mockTrxCreate(...args),
      flush: (...args: unknown[]) => mockTrxFlush(...args),
    }),
}

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_tenantId: string | null, fn: () => unknown) => fn()),
}))

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
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('../../../../guards', () => ({
  ...jest.requireActual('../../../../guards'),
  resolveUserFeatures: jest.fn(() => ['staff.timesheets.manage_own']),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) =>
    mockRunStaffMutationGuardAfterSuccess(...args),
  ),
}))

type LockedRow = {
  id: string
  lockedReportId: string
  date: Date
  timeProjectId: string
}

type FindWhere = Record<string, unknown>

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

function buildRequest(entries: Record<string, unknown>[]) {
  return new Request('http://localhost/api/staff/timesheets/time-entries/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
  })
}

/**
 * The route issues three `em.find` calls with distinct shapes — project
 * validation, the existing-id pre-check, and the lock pre-flight. Dispatching on
 * the `where` shape keeps the fake honest without depending on class identity
 * across `jest.resetModules()`.
 */
function wireEntityManagerFind(options: { existingIds?: string[]; locked?: LockedRow[] } = {}) {
  const existingIds = options.existingIds ?? []
  const locked = options.locked ?? []
  mockEntityManagerFind.mockImplementation(async (_cls: unknown, where: FindWhere) => {
    if (where.lockedReportId !== undefined) {
      lockQueries.push(where)
      return locked
    }
    if (where.staffMemberId !== undefined) {
      return existingIds.map((id) => ({ id }))
    }
    return [{ id: PROJECT_ID }, { id: OTHER_PROJECT_ID }]
  })
}

let lockQueries: FindWhere[] = []

describe('POST /api/staff/timesheets/time-entries/bulk lock gate (T4.2 / TC-TT-018)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    lockQueries = []
    for (const key of Object.keys(settingsStore)) delete settingsStore[key]
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      features: ['staff.timesheets.manage_own'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: TENANT_ID, selectedId: ORG_ID })
    mockFindOneWithDecryption.mockResolvedValue({ id: STAFF_MEMBER_ID })
    mockFindWithDecryption.mockResolvedValue([])
    mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    mockTrxCreate.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      id: CREATED_ENTRY_ID,
      ...data,
    }))
    mockTrxFlush.mockResolvedValue(undefined)
    wireEntityManagerFind()
  })

  it('refuses the batch when a row names a locked entry by id, naming the report that closed it', async () => {
    wireEntityManagerFind({
      existingIds: [LOCKED_ENTRY_ID],
      locked: [
        {
          id: LOCKED_ENTRY_ID,
          lockedReportId: REPORT_ID,
          date: new Date('2026-08-03T00:00:00.000Z'),
          timeProjectId: PROJECT_ID,
        },
      ],
    })
    const { POST } = await loadRoute()

    const response = await POST(
      buildRequest([{ id: LOCKED_ENTRY_ID, date: '2026-08-03', timeProjectId: PROJECT_ID, durationMinutes: 120 }]),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'time_entry_locked',
      lockedReportId: REPORT_ID,
      lockedEntryIds: [LOCKED_ENTRY_ID],
      lockedReportIds: [REPORT_ID],
    })
    expect(mockTrxCreate).not.toHaveBeenCalled()
    expect(mockTrxFlush).not.toHaveBeenCalled()
  })

  it('refuses an id-less row landing on a (project, date) cell a locked entry already occupies', async () => {
    // This is risk R3 verbatim: the grid targets the cell, not the row, so a
    // payload with no id would otherwise create a second entry beside the frozen
    // one and silently restate a billed day.
    wireEntityManagerFind({
      locked: [
        {
          id: LOCKED_ENTRY_ID,
          lockedReportId: REPORT_ID,
          date: new Date('2026-08-03T00:00:00.000Z'),
          timeProjectId: PROJECT_ID,
        },
      ],
    })
    const { POST } = await loadRoute()

    const response = await POST(buildRequest([{ date: '2026-08-03', timeProjectId: PROJECT_ID, durationMinutes: 120 }]))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'time_entry_locked',
      lockedEntryIds: [LOCKED_ENTRY_ID],
    })
    expect(mockTrxCreate).not.toHaveBeenCalled()
  })

  it('ignores a locked entry on a cell the payload never touches', async () => {
    // The (date × project) lookup is a cross product, so it can return a locked
    // row on a cell nobody is writing — that must not block the save.
    wireEntityManagerFind({
      locked: [
        {
          id: LOCKED_ENTRY_ID,
          lockedReportId: REPORT_ID,
          date: new Date('2026-08-04T00:00:00.000Z'),
          timeProjectId: OTHER_PROJECT_ID,
        },
      ],
    })
    const { POST } = await loadRoute()

    const response = await POST(
      buildRequest([
        { date: '2026-08-03', timeProjectId: PROJECT_ID, durationMinutes: 120 },
        { date: '2026-08-04', timeProjectId: PROJECT_ID, durationMinutes: 60 },
      ]),
    )

    expect(response.status).toBe(200)
  })

  it('fails a partially locked batch WHOLESALE, writing none of the unlocked rows', async () => {
    // Stated decision: all-or-nothing. The response carries only counts, so a
    // partial apply would leave the grid unable to tell which cells landed, and
    // the route already rejects the whole payload for an unknown project or a
    // stale id — a partial 409 would be the odd one out.
    wireEntityManagerFind({
      existingIds: [LOCKED_ENTRY_ID, FREE_ENTRY_ID],
      locked: [
        {
          id: LOCKED_ENTRY_ID,
          lockedReportId: REPORT_ID,
          date: new Date('2026-08-03T00:00:00.000Z'),
          timeProjectId: PROJECT_ID,
        },
      ],
    })
    mockFindWithDecryption.mockResolvedValue([
      { id: FREE_ENTRY_ID, durationMinutes: 60, roundedMinutes: 60, notes: null, deletedAt: null },
    ])
    const { POST } = await loadRoute()

    const response = await POST(
      buildRequest([
        { id: FREE_ENTRY_ID, date: '2026-08-04', timeProjectId: PROJECT_ID, durationMinutes: 30 },
        { id: LOCKED_ENTRY_ID, date: '2026-08-03', timeProjectId: PROJECT_ID, durationMinutes: 120 },
      ]),
    )

    expect(response.status).toBe(409)
    const body = (await response.json()) as { lockedEntryIds: string[] }
    // Only the offending id is named — the client marks that cell, not the batch.
    expect(body.lockedEntryIds).toEqual([LOCKED_ENTRY_ID])
    expect(mockTrxFlush).not.toHaveBeenCalled()
    expect(mockTrxCreate).not.toHaveBeenCalled()
  })

  it('scopes the lock lookup to the caller tenant, organization and staff member', async () => {
    const { POST } = await loadRoute()

    await POST(buildRequest([{ date: '2026-08-03', timeProjectId: PROJECT_ID, durationMinutes: 120 }]))

    expect(lockQueries).toHaveLength(1)
    expect(lockQueries[0]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      staffMemberId: STAFF_MEMBER_ID,
      deletedAt: null,
    })
  })

  it('writes rounded_minutes on a created row with the tenant rounding rule (D-7)', async () => {
    settingsStore['rounding.unitMinutes'] = 15
    settingsStore['rounding.direction'] = 'up'
    const { POST } = await loadRoute()
    const { roundMinutes } = await import('../../../../../lib/time-tracking/rounding')

    const response = await POST(buildRequest([{ date: '2026-08-03', timeProjectId: PROJECT_ID, durationMinutes: 61 }]))

    expect(response.status).toBe(200)
    expect(mockTrxCreate).toHaveBeenCalledTimes(1)
    const created = mockTrxCreate.mock.calls[0][1] as Record<string, unknown>
    expect(created.durationMinutes).toBe(61)
    expect(created.roundedMinutes).toBe(75)
    expect(created.roundedMinutes).toBe(roundMinutes(61, { unitMinutes: 15, direction: 'up' }))
  })

  it('restates rounded_minutes on an updated row instead of leaving the stale value', async () => {
    settingsStore['rounding.unitMinutes'] = 15
    settingsStore['rounding.direction'] = 'nearest'
    wireEntityManagerFind({ existingIds: [FREE_ENTRY_ID] })
    const existing = { id: FREE_ENTRY_ID, durationMinutes: 60, roundedMinutes: 60, notes: null, deletedAt: null }
    mockFindWithDecryption.mockResolvedValue([existing])
    const { POST } = await loadRoute()
    const { roundMinutes } = await import('../../../../../lib/time-tracking/rounding')

    const response = await POST(
      buildRequest([{ id: FREE_ENTRY_ID, date: '2026-08-03', timeProjectId: PROJECT_ID, durationMinutes: 76 }]),
    )

    expect(response.status).toBe(200)
    expect(existing.durationMinutes).toBe(76)
    expect(existing.roundedMinutes).toBe(75)
    expect(existing.roundedMinutes).toBe(roundMinutes(76, { unitMinutes: 15, direction: 'nearest' }))
  })

  it('falls back to the documented rounding defaults when tenant settings are unreadable', async () => {
    const { POST } = await loadRoute()

    const response = await POST(buildRequest([{ date: '2026-08-03', timeProjectId: PROJECT_ID, durationMinutes: 61 }]))

    expect(response.status).toBe(200)
    const created = mockTrxCreate.mock.calls[0][1] as Record<string, unknown>
    expect(created.roundedMinutes).toBe(61)
  })
})
