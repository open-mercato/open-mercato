/** @jest-environment node */

const foreignTenantId = '11111111-1111-4111-8111-111111111111'
const foreignOrgId = '22222222-2222-4222-8222-222222222222'
const tenantlessUserId = '33333333-3333-4333-8333-333333333333'
const superAdminUserId = '44444444-4444-4444-8444-444444444444'
const allowedOrgId = '55555555-5555-4555-8555-555555555555'
const invalidQueryPl = 'Nieprawidłowe zapytanie'

const authMock = jest.fn()
const resolveIsSuperAdminMock = jest.fn()
const enforceTenantSelectionMock = jest.fn()
const resolveOrganizationScopeMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const emFind = jest.fn()
const emFindOne = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return { find: emFind, findOne: emFindOne }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/auth/lib/tenantAccess')
  return {
    ...actual,
    resolveIsSuperAdmin: (...args: unknown[]) => resolveIsSuperAdminMock(...args),
    enforceTenantSelection: (...args: unknown[]) => enforceTenantSelectionMock(...args),
  }
})

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeMock(...args),
  getSelectedOrganizationFromRequest: () => null,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => {
  const polishDictionary: Record<string, string> = jest.requireActual('../../../i18n/pl.json')
  return {
    resolveTranslations: jest.fn(async () => ({
      locale: 'pl',
      translate: (key: string, fallback: string) => polishDictionary[key] ?? fallback,
    })),
  }
})

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

import { GET } from '../route'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'

describe('directory organizations GET — cross-tenant ?ids= guard (#2696)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    emFind.mockResolvedValue([])
    emFindOne.mockResolvedValue(null)
    findOneWithDecryptionMock.mockResolvedValue(null)
  })

  it('refuses a tenantless non-super-admin pivoting into another tenant via ?ids=', async () => {
    authMock.mockResolvedValue({ sub: tenantlessUserId, tenantId: null, orgId: null })
    resolveIsSuperAdminMock.mockResolvedValue(false)
    // tenantless caller has no permitted organization scope
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: null,
    })

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&ids=${foreignOrgId}`),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Tenant scope required')
    // The unscoped foreign-tenant discovery query must never run for this caller
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    // No foreign-tenant org rows leaked
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items).toHaveLength(0)
  })

  it('re-runs enforceTenantSelection on the derived tenant and refuses on a 403', async () => {
    authMock.mockResolvedValue({ sub: tenantlessUserId, tenantId: null, orgId: null })
    resolveIsSuperAdminMock.mockResolvedValue(false)
    // Caller is allowed to see allowedOrgId, but passes a foreign org id too.
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: allowedOrgId,
      filterIds: [allowedOrgId],
      allowedIds: [allowedOrgId],
      tenantId: null,
    })
    findWithDecryptionMock.mockResolvedValue([
      { id: allowedOrgId, tenant: { id: foreignTenantId } },
    ])
    enforceTenantSelectionMock.mockImplementation(async () => {
      throw forbidden('Not authorized to target this tenant.')
    })

    const response = await GET(
      new Request(
        `http://localhost/api/directory/organizations?view=options&ids=${allowedOrgId},${foreignOrgId}`,
      ),
    )

    // Only the in-scope id is used for discovery; the foreign id is filtered out.
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    const filter = findWithDecryptionMock.mock.calls[0][2] as { id: { $in: string[] } }
    expect(filter.id.$in).toEqual([allowedOrgId])
    // enforceTenantSelection rejects the pivot → clean 403, no org graph returned.
    expect(response.status).toBe(403)
  })

  it('still allows a super-admin to derive the tenant from ?ids=', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: null, orgId: null })
    resolveIsSuperAdminMock.mockResolvedValue(true)
    findWithDecryptionMock.mockResolvedValue([
      { id: foreignOrgId, tenant: { id: foreignTenantId } },
    ])
    enforceTenantSelectionMock.mockResolvedValue(foreignTenantId)
    emFind.mockResolvedValue([
      { id: foreignOrgId, name: 'Foreign Org', parentId: null, isActive: true, depth: 0, treePath: foreignOrgId },
    ])

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&ids=${foreignOrgId}`),
    )

    // Super-admins bypass the scope intersection — discovery runs on the raw ids.
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    const filter = findWithDecryptionMock.mock.calls[0][2] as { id: { $in: string[] } }
    expect(filter.id.$in).toEqual([foreignOrgId])
    expect(resolveOrganizationScopeMock).not.toHaveBeenCalled()
    expect(enforceTenantSelectionMock).toHaveBeenCalledWith(expect.anything(), foreignTenantId)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toHaveLength(1)
  })
})

describe('directory organizations GET — manage view exposes updatedAt for optimistic locking (#2989)', () => {
  const tenantOrgId = '66666666-6666-4666-8666-666666666666'
  const orgUpdatedAt = new Date('2026-06-01T10:20:30.000Z')

  beforeEach(() => {
    jest.clearAllMocks()
    emFind.mockResolvedValue([])
    emFindOne.mockResolvedValue(null)
    findWithDecryptionMock.mockResolvedValue([])
  })

  it('includes updatedAt in the super-admin aggregate manage view', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: null, orgId: null })
    resolveIsSuperAdminMock.mockResolvedValue(true)
    // Aggregate (all-tenants) manage view loads orgs via findWithDecryption.
    findWithDecryptionMock.mockResolvedValue([
      {
        id: foreignOrgId,
        name: 'Foreign Org',
        slug: 'foreign-org',
        parentId: null,
        isActive: true,
        updatedAt: orgUpdatedAt,
        tenant: { id: foreignTenantId },
      },
    ])
    emFind.mockResolvedValue([{ id: foreignTenantId, name: 'Foreign Tenant' }])

    const response = await GET(
      new Request('http://localhost/api/directory/organizations?view=manage&page=1&pageSize=50'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toHaveLength(1)
    // Without updatedAt the edit form cannot send the optimistic-lock header,
    // so concurrent edits silently overwrite each other (#2989).
    expect(body.items[0].updatedAt).toBe(orgUpdatedAt.toISOString())
  })

  it('includes updatedAt in the single-tenant manage view', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })
    resolveIsSuperAdminMock.mockResolvedValue(false)
    // Single-tenant manage view loads orgs via em.find.
    emFind.mockResolvedValue([
      {
        id: tenantOrgId,
        name: 'Tenant Org',
        slug: 'tenant-org',
        parentId: null,
        isActive: true,
        updatedAt: orgUpdatedAt,
        tenantId: foreignTenantId,
      },
    ])

    const response = await GET(
      new Request(
        `http://localhost/api/directory/organizations?view=manage&tenantId=${foreignTenantId}&page=1&pageSize=50`,
      ),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].updatedAt).toBe(orgUpdatedAt.toISOString())
  })
})

describe('directory organizations GET — pageSize honors the ≤100 platform cap (#3851)', () => {
  const tenantOrgId = '77777777-7777-4777-8777-777777777777'

  beforeEach(() => {
    jest.clearAllMocks()
    emFind.mockResolvedValue([])
    emFindOne.mockResolvedValue(null)
    findWithDecryptionMock.mockResolvedValue([])
  })

  it('rejects a pageSize above the 100-row platform cap', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })

    const response = await GET(
      new Request(
        `http://localhost/api/directory/organizations?view=manage&tenantId=${foreignTenantId}&page=1&pageSize=101`,
      ),
    )

    // Schema rejection short-circuits before any org query runs, so no oversized
    // page is ever assembled (#3851).
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ items: [], error: invalidQueryPl })
    expect(emFind).not.toHaveBeenCalled()
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('still accepts a pageSize at the 100-row cap', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })
    resolveIsSuperAdminMock.mockResolvedValue(false)
    emFind.mockResolvedValue([
      {
        id: tenantOrgId,
        name: 'Tenant Org',
        slug: 'tenant-org',
        parentId: null,
        isActive: true,
        updatedAt: new Date('2026-06-01T10:20:30.000Z'),
        tenantId: foreignTenantId,
      },
    ])

    const response = await GET(
      new Request(
        `http://localhost/api/directory/organizations?view=manage&tenantId=${foreignTenantId}&page=1&pageSize=100`,
      ),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.pageSize).toBe(100)
  })
})

describe('directory organizations GET — malformed ?ids= are rejected at the boundary (#7274)', () => {
  const tenantOrgId = '88888888-8888-4888-8888-888888888888'
  const unknownOrgId = '99999999-9999-4999-8999-999999999999'
  const views = ['options', 'manage', 'tree'] as const

  const tenantOrgRow = {
    id: tenantOrgId,
    name: 'Tenant Org',
    slug: 'tenant-org',
    parentId: null,
    isActive: true,
    depth: 0,
    treePath: tenantOrgId,
    updatedAt: new Date('2026-06-01T10:20:30.000Z'),
    tenantId: foreignTenantId,
  }

  function expectNoLookups() {
    expect(resolveIsSuperAdminMock).not.toHaveBeenCalled()
    expect(resolveOrganizationScopeMock).not.toHaveBeenCalled()
    expect(enforceTenantSelectionMock).not.toHaveBeenCalled()
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(emFind).not.toHaveBeenCalled()
    expect(emFindOne).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    emFind.mockResolvedValue([])
    emFindOne.mockResolvedValue(null)
    findWithDecryptionMock.mockResolvedValue([])
    findOneWithDecryptionMock.mockResolvedValue(null)
    resolveIsSuperAdminMock.mockResolvedValue(false)
  })

  it.each(views)('rejects a malformed id with 400 before any lookup (view=%s)', async (view) => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=${view}&ids=abc`),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toEqual({ items: [], error: invalidQueryPl })
    expectNoLookups()
  })

  it.each(views)('rejects a mixed valid/malformed id list with 400 (view=%s)', async (view) => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=${view}&ids=${tenantOrgId},not-a-uuid`),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toEqual({ items: [], error: invalidQueryPl })
    expectNoLookups()
  })

  it('rejects a malformed id from a tenantless caller before tenant derivation', async () => {
    authMock.mockResolvedValue({ sub: tenantlessUserId, tenantId: null, orgId: null })

    const response = await GET(
      new Request('http://localhost/api/directory/organizations?view=options&ids=abc'),
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe(invalidQueryPl)
    expectNoLookups()
  })

  it('rejects a malformed id from a super-admin in the all-tenants manage view', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: null, orgId: null })
    resolveIsSuperAdminMock.mockResolvedValue(true)

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=manage&ids=${unknownOrgId},abc`),
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe(invalidQueryPl)
    expectNoLookups()
  })

  it('returns an empty list for a valid but unknown id', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&ids=${unknownOrgId}`),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
    const where = emFind.mock.calls[0][1] as { id: { $in: string[] } }
    expect(where.id.$in).toEqual([unknownOrgId])
  })

  it('returns the scoped organization for valid ids in the options view', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })
    emFind.mockResolvedValue([tenantOrgRow])

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&ids=${tenantOrgId},%20${unknownOrgId},`),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([tenantOrgId])
    const where = emFind.mock.calls[0][1] as { tenant: string; id: { $in: string[] } }
    expect(where.tenant).toBe(foreignTenantId)
    expect(where.id.$in).toEqual([tenantOrgId, unknownOrgId])
  })

  it('accepts a non-RFC-version UUID that the database can still look up', async () => {
    const legacyOrgId = '00000000-0000-0000-0000-000000000001'
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&ids=${legacyOrgId}`),
    )

    expect(response.status).toBe(200)
    const where = emFind.mock.calls[0][1] as { id: { $in: string[] } }
    expect(where.id.$in).toEqual([legacyOrgId])
  })

  it('returns the requested organization for a valid id in the manage view', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })
    emFind.mockResolvedValue([tenantOrgRow])

    const response = await GET(
      new Request(
        `http://localhost/api/directory/organizations?view=manage&tenantId=${foreignTenantId}&ids=${tenantOrgId}&page=1&pageSize=1`,
      ),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([tenantOrgId])
  })

  it('returns the tenant tree for a valid id in the tree view', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: foreignTenantId, orgId: tenantOrgId })
    emFind.mockResolvedValue([tenantOrgRow])

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=tree&ids=${tenantOrgId}`),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([tenantOrgId])
  })
})
