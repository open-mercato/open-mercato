/** @jest-environment node */

const actorTenantId = '11111111-1111-4111-8111-111111111111'
const foreignTenantId = '22222222-2222-4222-8222-222222222222'

const em = {
  find: jest.fn(),
  findOne: jest.fn(),
} as { find: jest.Mock; findOne: jest.Mock }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const getAuthFromRequest = jest.fn()
const resolveIsSuperAdmin = jest.fn()
const getSelectedOrganizationFromRequest = jest.fn(() => null)
const resolveOrganizationScopeForRequest = jest.fn(async () => ({
  selectedId: null,
  filterIds: [],
  allowedIds: [],
}))
const findWithDecryption = jest.fn(async () => [])
const findOneWithDecryption = jest.fn(async () => null)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequest(...(args as [])),
}))

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  resolveIsSuperAdmin: (...args: unknown[]) => resolveIsSuperAdmin(...(args as [])),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  getSelectedOrganizationFromRequest: (...args: unknown[]) =>
    getSelectedOrganizationFromRequest(...(args as [])),
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    resolveOrganizationScopeForRequest(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...(args as [])),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: () => ({ metadata: {}, GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }),
  logCrudAccess: jest.fn(async () => {}),
}))

import { GET } from '../route'

const makeOrg = (id: string) => ({
  id,
  name: `Org ${id}`,
  parentId: null,
  isActive: true,
  depth: 0,
  treePath: id,
  slug: null,
})

describe('GET /api/directory/organizations tenant-scope guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getSelectedOrganizationFromRequest.mockReturnValue(null)
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: null, filterIds: [], allowedIds: [] })
    findOneWithDecryption.mockResolvedValue(null)
  })

  it('denies a non-superadmin requesting a foreign tenantId and never lists foreign-tenant orgs', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: 'user-a', tenantId: actorTenantId, orgId: null })
    resolveIsSuperAdmin.mockResolvedValue(false)

    const res = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&tenantId=${foreignTenantId}`),
    )

    expect(res.status).toBe(400)
    const body = (await res.json()) as { items: unknown[]; error?: string }
    expect(body.items).toEqual([])
    expect(body.error).toBe('Tenant scope required')
    expect(em.find).not.toHaveBeenCalled()
  })

  it('allows a non-superadmin to list their own tenant orgs', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: 'user-a', tenantId: actorTenantId, orgId: null })
    resolveIsSuperAdmin.mockResolvedValue(false)
    const own = makeOrg('aaaa1111-0000-4000-8000-000000000001')
    em.find.mockResolvedValue([own])

    const res = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&tenantId=${actorTenantId}`),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { id: string; tenantId: string }[] }
    expect(em.find).toHaveBeenCalledTimes(1)
    const [, where] = em.find.mock.calls[0]
    expect(where).toEqual(expect.objectContaining({ tenant: actorTenantId }))
    expect(body.items.map((it) => it.tenantId)).toEqual([actorTenantId])
  })

  it('allows a superadmin to list a foreign tenant orgs', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: 'super-1', tenantId: actorTenantId, orgId: null })
    resolveIsSuperAdmin.mockResolvedValue(true)
    const foreignOrg = makeOrg('bbbb2222-0000-4000-8000-000000000002')
    em.find.mockResolvedValue([foreignOrg])

    const res = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&tenantId=${foreignTenantId}`),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { id: string; tenantId: string }[] }
    expect(em.find).toHaveBeenCalledTimes(1)
    const [, where] = em.find.mock.calls[0]
    expect(where).toEqual(expect.objectContaining({ tenant: foreignTenantId }))
    expect(body.items.map((it) => it.tenantId)).toEqual([foreignTenantId])
  })
})
