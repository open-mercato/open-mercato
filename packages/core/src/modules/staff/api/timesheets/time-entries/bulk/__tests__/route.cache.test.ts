/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const timeProjectId = '44444444-4444-4444-8444-444444444444'
const createdEntryId = '55555555-5555-4555-8555-555555555555'

const deleteByTags = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunStaffMutationGuardAfterSuccess = jest.fn()
const mockEmitCrudSideEffects = jest.fn()
const mockFlushCrudSideEffects = jest.fn()
const mockEntityManagerFind = jest.fn()
const mockTrxCreate = jest.fn()
const mockTrxFlush = jest.fn()

const cache = {
  get: jest.fn(),
  set: jest.fn(),
  deleteByTags,
}

const forkedEntityManager = {
  find: (...args: unknown[]) => mockEntityManagerFind(...args),
  transactional: async (callback: (trx: unknown) => unknown) =>
    callback({
      create: (...args: unknown[]) => mockTrxCreate(...args),
      flush: (...args: unknown[]) => mockTrxFlush(...args),
    }),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return { fork: () => forkedEntityManager }
    if (token === 'dataEngine') return { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn() }
    if (token === 'cache') return cache
    return undefined
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

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn((...args: unknown[]) => mockEmitCrudSideEffects(...args)),
  flushCrudSideEffects: jest.fn((...args: unknown[]) => mockFlushCrudSideEffects(...args)),
}))

jest.mock('../../../../guards', () => ({
  resolveUserFeatures: jest.fn(() => ['staff.timesheets.manage_own']),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) =>
    mockRunStaffMutationGuardAfterSuccess(...args),
  ),
}))

const ORIGINAL_ENV = { ...process.env }

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

const buildRequest = () =>
  new Request('http://localhost/api/staff/timesheets/time-entries/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      entries: [{ date: '2026-08-03', timeProjectId, durationMinutes: 90 }],
    }),
  })

describe('POST /api/staff/timesheets/time-entries/bulk cache invalidation (#4970)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId,
      orgId: organizationId,
      features: ['staff.timesheets.manage_own'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId, selectedId: organizationId })
    mockFindOneWithDecryption.mockResolvedValue({ id: 'staff-member-1' })
    mockFindWithDecryption.mockResolvedValue([])
    mockEntityManagerFind.mockResolvedValue([{ id: timeProjectId }])
    mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    mockTrxCreate.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      id: createdEntryId,
      ...data,
    }))
    mockTrxFlush.mockResolvedValue(undefined)
    deleteByTags.mockResolvedValue(1)
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('flushes the cached time-entry list after a committed bulk save', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { POST } = await loadRoute()

    const response = await POST(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, created: 1, updated: 0, deleted: 0 })

    expect(mockFlushCrudSideEffects).toHaveBeenCalledTimes(1)
    expect(deleteByTags).toHaveBeenCalledTimes(1)

    const flushedTags = deleteByTags.mock.calls[0][0] as string[]
    expect(flushedTags).toContain(
      `crud:staff.timesheet:tenant:${tenantId}:org:${organizationId}:collection`,
    )
    expect(flushedTags).toContain(`crud:staff.timesheet:tenant:${tenantId}:org:null:collection`)
    expect(flushedTags).toContain(
      `crud:staff.timesheet:tenant:${tenantId}:record:${createdEntryId}`,
    )
  })

  it('invalidates every distinct record a multi-row save touched', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const secondEntryId = '66666666-6666-4666-8666-666666666666'
    const createdIds = [createdEntryId, secondEntryId]
    let createCallCount = 0
    mockTrxCreate.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      id: createdIds[createCallCount++],
      ...data,
    }))
    const { POST } = await loadRoute()

    const response = await POST(
      new Request('http://localhost/api/staff/timesheets/time-entries/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entries: [
            { date: '2026-08-03', timeProjectId, durationMinutes: 90 },
            { date: '2026-08-04', timeProjectId, durationMinutes: 30 },
          ],
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(deleteByTags).toHaveBeenCalledTimes(2)
    const allFlushedTags = deleteByTags.mock.calls.flatMap(([tags]) => tags as string[])
    expect(allFlushedTags).toContain(`crud:staff.timesheet:tenant:${tenantId}:record:${createdEntryId}`)
    expect(allFlushedTags).toContain(`crud:staff.timesheet:tenant:${tenantId}:record:${secondEntryId}`)
  })

  it('does not re-flush the same record twice when a payload repeats it', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { POST } = await loadRoute()

    const response = await POST(
      new Request('http://localhost/api/staff/timesheets/time-entries/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entries: [
            { date: '2026-08-03', timeProjectId, durationMinutes: 90 },
            { date: '2026-08-04', timeProjectId, durationMinutes: 30 },
          ],
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(deleteByTags).toHaveBeenCalledTimes(1)
  })

  it('does not touch the cache while the opt-in CRUD list cache is disabled', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { POST } = await loadRoute()

    const response = await POST(buildRequest())

    expect(response.status).toBe(200)
    expect(deleteByTags).not.toHaveBeenCalled()
  })
})
