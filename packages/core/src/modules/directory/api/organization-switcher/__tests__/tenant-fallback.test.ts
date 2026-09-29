/** @jest-environment node */

import type { NextRequest } from 'next/server'

// `findMock` returns tenants in the order the route asks for (name ASC), so the alphabetically
// first record is deliberately NOT the actor's home tenant — that is the wrong answer the
// `tenantRecords[0]` fallback produced for a scoped-away super-admin.
const alphabeticallyFirstTenantId = '11111111-1111-4111-8111-111111111111'
const homeTenantId = '55555555-5555-4555-8555-555555555555'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const organization = { id: organizationId, name: 'Acme Organization' }

const tenantRecords = [
  { id: alphabeticallyFirstTenantId, name: 'Aardvark Tenant', isActive: true },
  { id: homeTenantId, name: 'Zulu Tenant', isActive: true },
]

const hierarchyNode = {
  id: organizationId,
  name: organization.name,
  parentId: null,
  depth: 0,
  ancestorIds: [],
  descendantIds: [],
}

const authMock = jest.fn()
const createRequestContainerMock = jest.fn()
const logCrudAccessMock = jest.fn()
const computeHierarchyMock = jest.fn()
const getSelectedOrganizationMock = jest.fn()
const getSelectedTenantMock = jest.fn()
const resolveOrganizationScopeMock = jest.fn()
const runWithCacheTenantMock = jest.fn()
const findMock = jest.fn()
const loadAclMock = jest.fn()
const userHasAllFeaturesMock = jest.fn()

const em = { find: (...args: unknown[]) => findMock(...args) }
const rbac = {
  loadAcl: (...args: unknown[]) => loadAclMock(...args),
  userHasAllFeatures: (...args: unknown[]) => userHasAllFeaturesMock(...args),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbac
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  logCrudAccess: (...args: unknown[]) => logCrudAccessMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/lib/hierarchy', () => ({
  computeHierarchyForOrganizations: (...args: unknown[]) => computeHierarchyMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  buildOrgScopeTenantCacheTag: (value: string) => `org-scope:tenant:${value}`,
  getSelectedOrganizationFromRequest: (...args: unknown[]) => getSelectedOrganizationMock(...args),
  getSelectedTenantFromRequest: (...args: unknown[]) => getSelectedTenantMock(...args),
  resolveOrganizationScope: (...args: unknown[]) => resolveOrganizationScopeMock(...args),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: (...args: unknown[]) => runWithCacheTenantMock(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ error: jest.fn(), warn: jest.fn() }),
  }),
}))

function createRequest(): NextRequest {
  return new Request('http://localhost/api/directory/organization-switcher') as unknown as NextRequest
}

const loadRoute = () => import('../route')

describe('GET /api/directory/organization-switcher tenant fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createRequestContainerMock.mockResolvedValue(container)
    logCrudAccessMock.mockResolvedValue({ mode: 'batch', count: 1, pending: 0 })
    computeHierarchyMock.mockReturnValue({
      ordered: [hierarchyNode],
      map: new Map([[organizationId, hierarchyNode]]),
    })
    getSelectedOrganizationMock.mockReturnValue(organizationId)
    getSelectedTenantMock.mockReturnValue(null)
    resolveOrganizationScopeMock.mockImplementation(async () => ({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId: homeTenantId,
    }))
    runWithCacheTenantMock.mockImplementation((_tenantId: string, callback: () => unknown) => callback())
    findMock.mockImplementation(async (entity: { name?: string }) =>
      entity?.name === 'Tenant' ? tenantRecords : [organization],
    )
    loadAclMock.mockResolvedValue({
      isSuperAdmin: true,
      features: ['directory.organizations.manage'],
      organizations: [organizationId],
    })
    userHasAllFeaturesMock.mockResolvedValue(true)
  })

  it('restores a scoped-away super-admin to the tenant preserved under actorTenantId', async () => {
    authMock.mockResolvedValue({
      sub: userId,
      tenantId: null,
      orgId: null,
      isSuperAdmin: true,
      actorTenantId: homeTenantId,
      actorOrgId: organizationId,
    })

    const { GET } = await loadRoute()
    const response = await GET(createRequest())

    await expect(response.json()).resolves.toMatchObject({ tenantId: homeTenantId })
  })

  it('falls back to the session tenant when no actorTenantId was preserved', async () => {
    authMock.mockResolvedValue({
      sub: userId,
      tenantId: homeTenantId,
      orgId: organizationId,
      isSuperAdmin: true,
    })

    const { GET } = await loadRoute()
    const response = await GET(createRequest())

    await expect(response.json()).resolves.toMatchObject({ tenantId: homeTenantId })
  })

  it('still falls back to the first tenant for a genuinely tenant-less super-admin', async () => {
    authMock.mockResolvedValue({
      sub: userId,
      tenantId: null,
      orgId: null,
      isSuperAdmin: true,
      actorTenantId: null,
    })
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId: alphabeticallyFirstTenantId,
    })

    const { GET } = await loadRoute()
    const response = await GET(createRequest())

    await expect(response.json()).resolves.toMatchObject({ tenantId: alphabeticallyFirstTenantId })
  })

  it('keeps loading the ACL with the selected organization when a super-admin views another tenant', async () => {
    getSelectedTenantMock.mockReturnValue(alphabeticallyFirstTenantId)
    authMock.mockResolvedValue({
      sub: userId,
      tenantId: alphabeticallyFirstTenantId,
      orgId: organizationId,
      isSuperAdmin: true,
      actorTenantId: homeTenantId,
      actorOrgId: null,
    })
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId: alphabeticallyFirstTenantId,
    })

    const { GET } = await loadRoute()
    await GET(createRequest())

    expect(loadAclMock).toHaveBeenCalledWith(userId, {
      tenantId: alphabeticallyFirstTenantId,
      organizationId,
    })
  })
})
