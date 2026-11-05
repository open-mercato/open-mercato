/** @jest-environment node */

import type { NextRequest } from 'next/server'

const tenantId = '11111111-1111-4111-8111-111111111111'
const secondTenantId = '55555555-5555-4555-8555-555555555555'
const organizationId = '22222222-2222-4222-8222-222222222222'
const firstUserId = '33333333-3333-4333-8333-333333333333'
const secondUserId = '44444444-4444-4444-8444-444444444444'

const organization = {
  id: organizationId,
  name: 'Acme Organization',
}

const tenant = {
  id: tenantId,
  name: 'Acme Tenant',
  isActive: true,
}

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
const loggerWarnMock = jest.fn()

const cache = {
  get: jest.fn(),
  set: jest.fn(),
}

const em = {
  find: (...args: unknown[]) => findMock(...args),
}

const rbac = {
  loadAcl: (...args: unknown[]) => loadAclMock(...args),
  userHasAllFeatures: (...args: unknown[]) => userHasAllFeaturesMock(...args),
}

let cacheAvailable = true
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbac
    if (name === 'cache' && cacheAvailable) return cache
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
    child: () => ({
      error: jest.fn(),
      warn: (...args: unknown[]) => loggerWarnMock(...args),
    }),
  }),
}))

function createRequest(): NextRequest {
  return new Request('http://localhost/api/directory/organization-switcher') as unknown as NextRequest
}

function expectedPayload(overrides: Record<string, unknown> = {}) {
  return {
    items: [{
      id: organizationId,
      name: organization.name,
      depth: 0,
      selectable: true,
      children: [],
    }],
    selectedId: organizationId,
    canManage: true,
    canViewAllOrganizations: false,
    tenantId,
    tenants: [],
    isSuperAdmin: false,
    ...overrides,
  }
}

const loadRoute = () => import('../route')

describe('GET /api/directory/organization-switcher caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    cacheAvailable = true
    authMock.mockResolvedValue({
      sub: firstUserId,
      tenantId,
      orgId: organizationId,
      isSuperAdmin: false,
    })
    createRequestContainerMock.mockResolvedValue(container)
    logCrudAccessMock.mockResolvedValue({ mode: 'batch', count: 1, pending: 0 })
    computeHierarchyMock.mockReturnValue({
      ordered: [hierarchyNode],
      map: new Map([[organizationId, hierarchyNode]]),
    })
    getSelectedOrganizationMock.mockReturnValue(organizationId)
    getSelectedTenantMock.mockReturnValue(null)
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    })
    runWithCacheTenantMock.mockImplementation((_tenantId: string, callback: () => unknown) => callback())
    findMock.mockImplementation(async (entity: { name?: string }) =>
      entity?.name === 'Tenant' ? [tenant] : [organization],
    )
    loadAclMock.mockResolvedValue({
      isSuperAdmin: false,
      features: ['directory.organizations.manage'],
      organizations: [organizationId],
    })
    userHasAllFeaturesMock.mockResolvedValue(true)
    cache.get.mockResolvedValue(null)
    cache.set.mockResolvedValue(undefined)
  })

  it('stores the assembled response under the user, tenant, and selection key with existing invalidation tags', async () => {
    const { GET } = await loadRoute()

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expectedPayload())
    expect(cache.get).toHaveBeenCalledWith(
      `org-switcher:v1:${firstUserId}:${tenantId}:org:${organizationId}`,
    )
    expect(cache.set).toHaveBeenCalledWith(
      `org-switcher:v1:${firstUserId}:${tenantId}:org:${organizationId}`,
      expectedPayload(),
      {
        ttl: 60_000,
        tags: [
          `org-scope:tenant:${tenantId}`,
          `rbac:user:${firstUserId}`,
        ],
      },
    )
    expect(runWithCacheTenantMock).toHaveBeenCalledWith(tenantId, expect.any(Function))
    expect(logCrudAccessMock).toHaveBeenCalledTimes(1)
  })

  it('serves the second identical request from cache without repeating organization or RBAC work and still audits both reads', async () => {
    const { GET } = await loadRoute()
    cache.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(expectedPayload())

    const firstResponse = await GET(createRequest())
    const secondResponse = await GET(createRequest())

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    await expect(secondResponse.json()).resolves.toEqual(expectedPayload())
    expect(findMock).toHaveBeenCalledTimes(1)
    expect(loadAclMock).toHaveBeenCalledTimes(1)
    expect(userHasAllFeaturesMock).toHaveBeenCalledTimes(1)
    expect(resolveOrganizationScopeMock).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(logCrudAccessMock).toHaveBeenCalledTimes(2)
  })

  it('caches the existing minimal response for users without a visible organization menu', async () => {
    const { GET } = await loadRoute()
    const minimalPayload = {
      items: [],
      selectedId: null,
      canManage: false,
    }
    computeHierarchyMock.mockReturnValue({
      ordered: [],
      map: new Map(),
    })
    loadAclMock.mockResolvedValue({
      isSuperAdmin: false,
      features: [],
      organizations: [],
    })
    userHasAllFeaturesMock.mockResolvedValue(false)
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: null,
      filterIds: [],
      allowedIds: [],
      tenantId,
    })
    cache.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(minimalPayload)

    const firstResponse = await GET(createRequest())
    const secondResponse = await GET(createRequest())

    await expect(firstResponse.json()).resolves.toEqual(minimalPayload)
    await expect(secondResponse.json()).resolves.toEqual(minimalPayload)
    expect(findMock).toHaveBeenCalledTimes(1)
    expect(loadAclMock).toHaveBeenCalledTimes(1)
    expect(userHasAllFeaturesMock).toHaveBeenCalledTimes(1)
    expect(resolveOrganizationScopeMock).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(logCrudAccessMock).toHaveBeenCalledTimes(2)
  })

  it('isolates cache entries by user, tenant, and selected organization mode', async () => {
    const { GET } = await loadRoute()
    authMock
      .mockResolvedValueOnce({
        sub: firstUserId,
        tenantId,
        orgId: organizationId,
        isSuperAdmin: false,
      })
      .mockResolvedValueOnce({
        sub: secondUserId,
        tenantId,
        orgId: organizationId,
        isSuperAdmin: false,
      })
      .mockResolvedValueOnce({
        sub: firstUserId,
        tenantId: secondTenantId,
        orgId: organizationId,
        isSuperAdmin: false,
      })
    getSelectedOrganizationMock
      .mockReturnValueOnce(organizationId)
      .mockReturnValueOnce('__all__')
      .mockReturnValueOnce(organizationId)

    await GET(createRequest())
    await GET(createRequest())
    await GET(createRequest())

    const keys = cache.get.mock.calls.map(([key]) => key)
    expect(keys).toEqual([
      `org-switcher:v1:${firstUserId}:${tenantId}:org:${organizationId}`,
      `org-switcher:v1:${secondUserId}:${tenantId}:mode:all`,
      `org-switcher:v1:${firstUserId}:${secondTenantId}:org:${organizationId}`,
    ])
  })

  it('does not cache an invalid concrete organization cookie', async () => {
    const { GET } = await loadRoute()
    getSelectedOrganizationMock.mockReturnValue('all')

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    expect(container.resolve).not.toHaveBeenCalledWith('cache')
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('never caches global superadmin responses', async () => {
    const { GET } = await loadRoute()
    authMock.mockResolvedValue({
      sub: firstUserId,
      tenantId,
      orgId: organizationId,
      isSuperAdmin: true,
    })
    loadAclMock.mockResolvedValue({
      isSuperAdmin: true,
      features: ['*'],
      organizations: null,
    })
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: null,
      allowedIds: null,
      tenantId,
    })

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(container.resolve).not.toHaveBeenCalledWith('cache')
  })

  it('falls back to normal computation when the cache backend fails', async () => {
    const { GET } = await loadRoute()
    cache.get.mockRejectedValue(new Error('cache unavailable'))
    cache.set.mockRejectedValue(new Error('cache unavailable'))

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expectedPayload())
    expect(findMock).toHaveBeenCalledTimes(1)
    expect(logCrudAccessMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the endpoint functional when no cache service is registered', async () => {
    const { GET } = await loadRoute()
    cacheAvailable = false

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expectedPayload())
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })
})
