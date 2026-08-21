/** @jest-environment node */

import { DELETE, GET } from '@open-mercato/core/modules/auth/api/roles/route'
import { RoleAcl } from '@open-mercato/core/modules/auth/data/entities'

const mockGetAuthFromRequest = jest.fn()
const mockLoadAcl = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockLogCrudAccess = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { loadAcl: mockLoadAcl }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

type CapturedCrudOpts = { metadata: unknown; actions?: Record<string, any> } | null

// `var` so the binding is hoisted as `undefined` at the time jest.mock's
// factory closure runs during `roles/route.ts` import. `let`/`const`
// declarations stay in the TDZ until their source line executes, which
// would throw `Cannot access 'mockCapturedCrudOpts' before initialization`
// because makeCrudRoute is invoked at the route module's top level — before
// the test file's own top-level declarations run. The `mock` prefix also
// satisfies babel-plugin-jest-hoist's allow-list for variables referenced
// inside jest.mock factories.
var mockCapturedCrudOpts: CapturedCrudOpts

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: { metadata: unknown; actions?: Record<string, any> }) => {
    mockCapturedCrudOpts = opts as CapturedCrudOpts
    return {
      metadata: opts.metadata,
      POST: jest.fn(),
      PUT: jest.fn(),
      DELETE: jest.fn(),
    }
  }),
  logCrudAccess: jest.fn((args: unknown) => mockLogCrudAccess(args)),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

const actorTenantId = '123e4567-e89b-12d3-a456-426614174003'
const requestedTenantId = '123e4567-e89b-12d3-a456-426614174004'

function makeRequest(path = '/api/auth/roles') {
  return new Request(`http://localhost${path}`, { method: 'GET' })
}

describe('GET /api/auth/roles', () => {
  beforeEach(() => {
    mockGetAuthFromRequest.mockReset()
    mockLoadAcl.mockReset()
    mockEm.find.mockReset()
    mockEm.findOne.mockReset()
    mockEm.findAndCount.mockReset()
    mockEm.findOne.mockResolvedValue(null)
    mockLoadCustomFieldValues.mockReset()
    mockLogCrudAccess.mockReset()
    mockContainer.resolve.mockClear()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: actorTenantId,
      orgId: '223e4567-e89b-12d3-a456-426614174003',
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValue({ isSuperAdmin: false })
    mockEm.find.mockResolvedValue([])
    mockEm.findAndCount.mockResolvedValue([[], 0])
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockLogCrudAccess.mockResolvedValue(undefined)
  })

  test('returns an empty collection when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce(null)

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [], total: 0, totalPages: 1 })
    expect(mockContainer.resolve).not.toHaveBeenCalled()
  })

  test('returns an empty collection for non-superadmin users without tenant context', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce({
      sub: 'user-1',
      tenantId: null,
      orgId: '223e4567-e89b-12d3-a456-426614174003',
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: false })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [], total: 0, totalPages: 1, isSuperAdmin: false })
    expect(mockEm.findAndCount).not.toHaveBeenCalled()
  })

  test('applies tenant-scoped filters and excludes superadmin roles for non-superadmin actor', async () => {
    mockEm.find
      .mockResolvedValueOnce([{ role: { id: '323e4567-e89b-12d3-a456-426614174050' } }])
      .mockResolvedValueOnce([])
    mockEm.findAndCount.mockResolvedValueOnce([[], 0])

    await GET(makeRequest('/api/auth/roles?search=manager'))

    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }

    expect(Array.isArray(where.$and)).toBe(true)
    expect(where.$and).toEqual(expect.arrayContaining([
      { deletedAt: null },
      { name: { $ilike: '%manager%' } },
      { tenantId: actorTenantId },
      { name: { $ne: 'superadmin' } },
      { id: { $nin: ['323e4567-e89b-12d3-a456-426614174050'] } },
    ]))
  })

  test('applies requested tenant scope for superadmin actor', async () => {
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: true })
    mockEm.findAndCount.mockResolvedValueOnce([[], 0])

    const response = await GET(makeRequest(`/api/auth/roles?tenantId=${requestedTenantId}&page=1&pageSize=20`))
    const body = await response.json()

    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    expect(where.$and).toEqual(expect.arrayContaining([
      { deletedAt: null },
      { tenantId: requestedTenantId },
    ]))
    expect(where.$and).not.toEqual(expect.arrayContaining([{ name: { $ne: 'superadmin' } }]))
    expect(body.isSuperAdmin).toBe(true)
  })

  test('DELETE rejects non-super admin actors deleting a super admin role', async () => {
    const superAdminRoleId = '323e4567-e89b-12d3-a456-426614174999'
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: false })
    mockEm.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === RoleAcl) return { isSuperAdmin: true }
      return null
    })

    const response = await DELETE(new Request(`http://localhost/api/auth/roles?id=${superAdminRoleId}`, {
      method: 'DELETE',
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('super administrator')
  })

  test('returns roles with usersCount and tenant visibility fields', async () => {
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: true })
    mockEm.findAndCount.mockResolvedValueOnce([
      [{ id: 'role-1', name: 'Manager', tenantId: actorTenantId }],
      1,
    ])
    mockEm.find
      .mockResolvedValueOnce([{ role: 'role-1', deletedAt: null }])
      .mockResolvedValueOnce([{ id: actorTenantId, name: 'Main Tenant' }])

    const response = await GET(makeRequest('/api/auth/roles?page=1&pageSize=10'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: 'role-1',
      name: 'Manager',
      usersCount: 1,
      tenantId: actorTenantId,
      tenantIds: [actorTenantId],
      tenantName: 'Main Tenant',
    })
  })
})

// Regression coverage for finding #3 in report-high.md: cross-tenant role
// create/update/delete via body-supplied tenantId. The route's mapInput
// callbacks must reject foreign tenantIds before the command bus ever runs.
describe('roles route — cross-tenant tenant guard wiring (finding #3)', () => {
  const roleIdOwn = '323e4567-e89b-12d3-a456-426614174001'
  const roleIdForeign = '323e4567-e89b-12d3-a456-426614174002'

  function makeMapInputCtx({
    isSuperAdmin = false,
    tenantId = actorTenantId as string | null,
    existingRole = null as { id: string; tenantId: string | null } | null,
  } = {}) {
    mockEm.findOne.mockReset()
    mockEm.findOne.mockResolvedValue(existingRole)
    return {
      auth: { sub: 'user-1', tenantId, orgId: null, isSuperAdmin },
      container: {
        resolve: (token: string) => {
          if (token === 'em') return mockEm
          if (token === 'rbacService') return { loadAcl: async () => ({ isSuperAdmin }) }
          throw new Error(`Unexpected service: ${token}`)
        },
      },
      request: undefined,
    } as any
  }

  beforeAll(() => {
    expect(mockCapturedCrudOpts).not.toBeNull()
    expect(mockCapturedCrudOpts?.actions).toBeDefined()
  })

  test('create.mapInput rejects body.tenantId when it differs from auth.tenantId for non-superadmin', async () => {
    const action = mockCapturedCrudOpts?.actions?.create
    expect(typeof action?.mapInput).toBe('function')
    const ctx = makeMapInputCtx({ tenantId: actorTenantId })

    await expect(
      action!.mapInput({ parsed: { name: 'Owner', tenantId: requestedTenantId }, raw: {}, ctx }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('create.mapInput accepts own-tenant payload', async () => {
    const action = mockCapturedCrudOpts?.actions?.create
    const ctx = makeMapInputCtx({ tenantId: actorTenantId })

    await expect(
      action!.mapInput({ parsed: { name: 'Owner', tenantId: actorTenantId }, raw: {}, ctx }),
    ).resolves.toMatchObject({ name: 'Owner', tenantId: actorTenantId })
  })

  test('create.mapInput defaults non-superadmin to auth.tenantId when body tenantId is omitted', async () => {
    const action = mockCapturedCrudOpts?.actions?.create
    const ctx = makeMapInputCtx({ tenantId: actorTenantId })

    await expect(
      action!.mapInput({ parsed: { name: 'Owner' }, raw: {}, ctx }),
    ).resolves.toMatchObject({ name: 'Owner', tenantId: actorTenantId })
  })

  test('update.mapInput rejects cross-tenant role lookup for non-superadmin', async () => {
    const action = mockCapturedCrudOpts?.actions?.update
    expect(typeof action?.mapInput).toBe('function')
    const ctx = makeMapInputCtx({
      tenantId: actorTenantId,
      existingRole: { id: roleIdForeign, tenantId: requestedTenantId },
    })

    await expect(
      action!.mapInput({ parsed: { id: roleIdForeign, name: 'Renamed' }, raw: {}, ctx }),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('update.mapInput allows own-tenant role update for non-superadmin', async () => {
    const action = mockCapturedCrudOpts?.actions?.update
    const ctx = makeMapInputCtx({
      tenantId: actorTenantId,
      existingRole: { id: roleIdOwn, tenantId: actorTenantId },
    })

    await expect(
      action!.mapInput({ parsed: { id: roleIdOwn, name: 'Renamed' }, raw: {}, ctx }),
    ).resolves.toMatchObject({ id: roleIdOwn, name: 'Renamed' })
  })

  test('update.mapInput allows superadmin to update any-tenant role', async () => {
    const action = mockCapturedCrudOpts?.actions?.update
    const ctx = makeMapInputCtx({
      isSuperAdmin: true,
      tenantId: actorTenantId,
      existingRole: { id: roleIdForeign, tenantId: requestedTenantId },
    })

    await expect(
      action!.mapInput({ parsed: { id: roleIdForeign, name: 'Renamed' }, raw: {}, ctx }),
    ).resolves.toMatchObject({ id: roleIdForeign, name: 'Renamed' })
  })

  test('delete.mapInput rejects cross-tenant role for non-superadmin', async () => {
    const action = mockCapturedCrudOpts?.actions?.delete
    expect(typeof action?.mapInput).toBe('function')
    const ctx = makeMapInputCtx({
      tenantId: actorTenantId,
      existingRole: { id: roleIdForeign, tenantId: requestedTenantId },
    })

    await expect(
      action!.mapInput({
        parsed: { body: {}, query: { id: roleIdForeign } },
        raw: { body: {}, query: { id: roleIdForeign } },
        ctx,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('delete.mapInput allows own-tenant role for non-superadmin', async () => {
    const action = mockCapturedCrudOpts?.actions?.delete
    const ctx = makeMapInputCtx({
      tenantId: actorTenantId,
      existingRole: { id: roleIdOwn, tenantId: actorTenantId },
    })

    const parsed = { body: {}, query: { id: roleIdOwn } }
    await expect(action!.mapInput({ parsed, raw: parsed, ctx })).resolves.toBe(parsed)
  })
})
