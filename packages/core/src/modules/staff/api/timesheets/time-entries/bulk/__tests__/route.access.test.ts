/** @jest-environment node */
// #6988 — the grid bulk save applies the same project access as the entry dialog:
// the member must be assigned to the project today (D-12) and the assignment must
// cover the row's date. Before this, the route checked only that the project
// existed, so the grid accepted rows the dialog refused.

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const assignedProjectId = '44444444-4444-4444-8444-444444444444'
const unassignedProjectId = '44444444-4444-4444-8444-4444444444ff'
const existingEntryId = '55555555-5555-4555-8555-555555555555'
const staffMemberId = 'staff-member-1'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockEntityManagerFind = jest.fn()
const mockTrxCreate = jest.fn()

const forkedEntityManager = {
  find: (...args: unknown[]) => mockEntityManagerFind(...args),
  transactional: async (callback: (trx: unknown) => unknown) =>
    callback({
      create: (...args: unknown[]) => mockTrxCreate(...args),
      flush: async () => undefined,
    }),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return { fork: () => forkedEntityManager }
    if (token === 'dataEngine') return { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn() }
    if (token === 'rbacService') {
      return { userHasAllFeatures: async () => false, getGrantedFeatures: async () => ['staff.timesheets.manage_own'] }
    }
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
  emitCrudSideEffects: jest.fn(),
  flushCrudSideEffects: jest.fn(),
}))

jest.mock('../../../../guards', () => ({
  ...jest.requireActual('../../../../guards'),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn(),
}))

const entityName = (entity: unknown): string => (entity as { name?: string }).name ?? ''

const assignedSince2020 = {
  id: 'assignment-1',
  staffMemberId,
  timeProjectId: assignedProjectId,
  assignedStartDate: '2020-01-01',
  assignedEndDate: null,
}

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

const buildRequest = (entries: Record<string, unknown>[]) =>
  new Request('http://localhost/api/staff/timesheets/time-entries/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
  })

function useWorld(options: { memberships: Record<string, unknown>[]; storedEntries?: Record<string, unknown>[] }) {
  const storedEntries = options.storedEntries ?? []
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entityName(entity) === 'StaffTimeProjectMember') return options.memberships
    if (entityName(entity) === 'StaffTimeEntry') return storedEntries
    return []
  })
  mockEntityManagerFind.mockImplementation(async (entity: unknown, where: { id?: { $in?: string[] } }) => {
    const ids = where.id?.$in ?? []
    if (entityName(entity) === 'StaffTimeProject') return ids.map((id) => ({ id }))
    if (entityName(entity) === 'StaffTimeEntry') return storedEntries.filter((row) => ids.includes(row.id as string))
    return []
  })
}

describe('POST /api/staff/timesheets/time-entries/bulk project access (#6988)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId, orgId: organizationId })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId, selectedId: organizationId })
    mockFindOneWithDecryption.mockResolvedValue({ id: staffMemberId })
    mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    mockTrxCreate.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: 'new-entry', ...data }))
  })

  it('saves a row on an assigned project dated inside the assignment', async () => {
    useWorld({ memberships: [assignedSince2020] })
    const { POST } = await loadRoute()

    const response = await POST(
      buildRequest([{ date: '2026-08-03', timeProjectId: assignedProjectId, durationMinutes: 60 }]),
    )

    expect(response.status).toBe(200)
    expect(mockTrxCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses the whole batch when a row targets a project the member is not assigned to', async () => {
    useWorld({ memberships: [assignedSince2020] })
    const { POST } = await loadRoute()

    const response = await POST(
      buildRequest([
        { date: '2026-08-03', timeProjectId: assignedProjectId, durationMinutes: 60 },
        { date: '2026-08-03', timeProjectId: unassignedProjectId, durationMinutes: 30 },
      ]),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'You are not assigned to this project.',
      errors: [{ path: 'entries[].timeProjectId', value: unassignedProjectId }],
    })
    expect(mockTrxCreate).not.toHaveBeenCalled()
  })

  it('refuses a row dated before the assignment starts', async () => {
    useWorld({ memberships: [assignedSince2020] })
    const { POST } = await loadRoute()

    const response = await POST(
      buildRequest([{ date: '2019-12-31', timeProjectId: assignedProjectId, durationMinutes: 60 }]),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: 'This date is outside your assignment to this project.',
    })
    expect(mockTrxCreate).not.toHaveBeenCalled()
  })

  it('refuses moving an existing entry off a project the member can no longer write', async () => {
    useWorld({
      memberships: [assignedSince2020],
      storedEntries: [
        { id: existingEntryId, staffMemberId, timeProjectId: unassignedProjectId, date: '2026-08-03', durationMinutes: 60 },
      ],
    })
    const { POST } = await loadRoute()

    const response = await POST(
      buildRequest([
        { id: existingEntryId, date: '2026-08-03', timeProjectId: assignedProjectId, durationMinutes: 60 },
      ]),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      errors: [{ value: unassignedProjectId }],
    })
  })

  it('refuses everything for a member with no assignments, as the entry dialog does', async () => {
    useWorld({ memberships: [] })
    const { POST } = await loadRoute()

    const response = await POST(
      buildRequest([{ date: '2026-08-03', timeProjectId: assignedProjectId, durationMinutes: 60 }]),
    )

    expect(response.status).toBe(403)
    expect(mockTrxCreate).not.toHaveBeenCalled()
  })
})
