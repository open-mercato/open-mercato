import { GET } from '@open-mercato/core/modules/perspectives/api/[tableId]/route'

const mockGetAuthFromRequest = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockLoadPerspectivesState = jest.fn()

const tenantA = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0'
const tenantB = 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0'
const userId = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0'
const orgId = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0'

const roleTenantA = { id: 'role-1-tenant-a', name: 'Manager', tenantId: tenantA, deletedAt: null }
const roleTenantB = { id: 'role-2-tenant-b', name: 'Manager', tenantId: tenantB, deletedAt: null }
let roleRows: Array<typeof roleTenantA> = [roleTenantA, roleTenantB]

function matchesRoleWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  if ('deletedAt' in where && row.deletedAt !== where.deletedAt) return false
  if ('tenantId' in where && row.tenantId !== where.tenantId) return false
  const nameFilter = where.name as { $in?: string[] } | undefined
  if (nameFilter?.$in && !nameFilter.$in.includes(row.name as string)) return false
  return true
}

const mockEm = {
  find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
    roleRows.filter((row) => matchesRoleWhere(row, where)),
  ),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'cache') return null
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/perspectives/services/perspectiveService', () => ({
  loadPerspectivesState: jest.fn((...args: unknown[]) => mockLoadPerspectivesState(...args)),
  saveUserPerspective: jest.fn(),
  saveRolePerspectives: jest.fn(),
  clearRolePerspectives: jest.fn(),
}))

function makeRequest() {
  return new Request('http://localhost/api/perspectives/orders', { method: 'GET' })
}

describe('GET /api/perspectives/[tableId] (issue #3276)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    roleRows = [roleTenantA, roleTenantB]
    mockGetAuthFromRequest.mockResolvedValue({
      sub: userId,
      tenantId: tenantA,
      orgId,
      roles: ['Manager'],
    })
    mockUserHasAllFeatures.mockResolvedValue(false)
    mockLoadPerspectivesState.mockResolvedValue({
      tableId: 'orders',
      personal: [],
      personalDefaultId: null,
      rolePerspectives: [],
    })
  })

  test('scopes the assigned-role lookup to the caller tenant', async () => {
    const res = await GET(makeRequest(), { params: { tableId: 'orders' } })
    expect(res.status).toBe(200)

    const whereArg = mockEm.find.mock.calls[0]?.[1] as Record<string, unknown>
    expect(whereArg.tenantId).toBe(tenantA)
  })

  test('does not return a same-named role belonging to another tenant', async () => {
    const res = await GET(makeRequest(), { params: { tableId: 'orders' } })
    const body = await res.json()

    expect(body.roles).toHaveLength(1)
    expect(body.roles[0].id).toBe(roleTenantA.id)
    expect(body.roles.find((role: { id: string }) => role.id === roleTenantB.id)).toBeUndefined()
  })

  test('never passes the foreign role id into role-perspective resolution', async () => {
    await GET(makeRequest(), { params: { tableId: 'orders' } })

    const stateOptions = mockLoadPerspectivesState.mock.calls[0]?.[2] as { roleIds: string[] }
    expect(stateOptions.roleIds).toEqual([roleTenantA.id])
    expect(stateOptions.roleIds).not.toContain(roleTenantB.id)
  })

  test('returns no assigned roles when only another tenant has the matching role name', async () => {
    roleRows = [roleTenantB]

    const res = await GET(makeRequest(), { params: { tableId: 'orders' } })
    const body = await res.json()

    expect(body.roles).toHaveLength(0)
  })
})
