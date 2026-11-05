/** @jest-environment node */

import type { NextRequest } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createCacheService, runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import invalidateOrgScopeCache from '@open-mercato/core/modules/directory/subscribers/invalidateOrgScopeCache'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const otherUserId = '44444444-4444-4444-8444-444444444444'
const cacheKey = `org-switcher:v1:${userId}:${tenantId}:org:${organizationId}`
const otherUserCacheKey = `org-switcher:v1:${otherUserId}:${tenantId}:org:${organizationId}`

const authMock = jest.fn()
const createRequestContainerMock = jest.fn()
const logCrudAccessMock = jest.fn()
const computeHierarchyMock = jest.fn()
const getSelectedOrganizationMock = jest.fn()
const getSelectedTenantMock = jest.fn()
const resolveOrganizationScopeMock = jest.fn()
const findMock = jest.fn()
const loadAclMock = jest.fn()
const userHasAllFeaturesMock = jest.fn()

const cache = createCacheService({ strategy: 'memory' })
const em = {
  find: (...args: unknown[]) => findMock(...args),
}
const rbac = {
  loadAcl: (...args: unknown[]) => loadAclMock(...args),
  userHasAllFeatures: (...args: unknown[]) => userHasAllFeaturesMock(...args),
}
const container = {
  resolve: <T = unknown>(name: string): T => {
    if (name === 'em') return em as T
    if (name === 'rbacService') return rbac as T
    if (name === 'cache') return cache as T
    throw new Error(`Unexpected container resolve: ${name}`)
  },
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
  buildOrgScopeUserCacheTag: (value: string) => `org-scope:user:${value}`,
  getSelectedOrganizationFromRequest: (...args: unknown[]) => getSelectedOrganizationMock(...args),
  getSelectedTenantFromRequest: (...args: unknown[]) => getSelectedTenantMock(...args),
  resolveOrganizationScope: (...args: unknown[]) => resolveOrganizationScopeMock(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({
      error: jest.fn(),
      warn: jest.fn(),
    }),
  }),
}))

function createRequest(): NextRequest {
  return new Request('http://localhost/api/directory/organization-switcher') as unknown as NextRequest
}

async function listSwitcherCacheKeys(): Promise<string[]> {
  return runWithCacheTenant(tenantId, () => cache.keys('org-switcher:*'))
}

const loadRoute = () => import('../route')

describe('GET /api/directory/organization-switcher real cache invalidation', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await runWithCacheTenant(tenantId, () => cache.clear())
    authMock.mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: organizationId,
      isSuperAdmin: false,
    })
    createRequestContainerMock.mockResolvedValue(container)
    logCrudAccessMock.mockResolvedValue({ mode: 'batch', count: 1, pending: 0 })
    computeHierarchyMock.mockReturnValue({
      ordered: [{
        id: organizationId,
        name: 'Acme Organization',
        parentId: null,
        depth: 0,
        ancestorIds: [],
        descendantIds: [],
      }],
      map: new Map([[
        organizationId,
        {
          id: organizationId,
          name: 'Acme Organization',
          parentId: null,
          depth: 0,
          ancestorIds: [],
          descendantIds: [],
        },
      ]]),
    })
    getSelectedOrganizationMock.mockReturnValue(organizationId)
    getSelectedTenantMock.mockReturnValue(null)
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    })
    findMock.mockResolvedValue([{
      id: organizationId,
      name: 'Acme Organization',
    }])
    loadAclMock.mockResolvedValue({
      isSuperAdmin: false,
      features: ['directory.organizations.manage'],
      organizations: [organizationId],
    })
    userHasAllFeaturesMock.mockResolvedValue(true)
  })

  it('removes a warmed switcher entry through the organization event subscriber', async () => {
    const { GET } = await loadRoute()

    await GET(createRequest())
    await GET(createRequest())

    expect(findMock).toHaveBeenCalledTimes(1)
    await expect(listSwitcherCacheKeys()).resolves.toEqual([cacheKey])

    await invalidateOrgScopeCache(
      { tenantId, id: organizationId },
      container,
    )

    await expect(listSwitcherCacheKeys()).resolves.toEqual([])
    await GET(createRequest())
    expect(findMock).toHaveBeenCalledTimes(2)
  })

  it('removes only the warmed user entry through RbacService invalidation', async () => {
    const { GET } = await loadRoute()
    const rbacService = new RbacService({} as EntityManager, cache)

    await GET(createRequest())
    await GET(createRequest())
    await runWithCacheTenant(tenantId, () =>
      cache.set(
        otherUserCacheKey,
        {
          items: [],
          selectedId: null,
          canManage: false,
        },
        {
          ttl: 60_000,
          tags: [`rbac:user:${otherUserId}`],
        },
      ),
    )

    expect(findMock).toHaveBeenCalledTimes(1)
    await expect(listSwitcherCacheKeys()).resolves.toEqual(
      expect.arrayContaining([cacheKey, otherUserCacheKey]),
    )

    await runWithCacheTenant(tenantId, () => rbacService.invalidateUserCache(userId))

    await expect(listSwitcherCacheKeys()).resolves.toEqual([otherUserCacheKey])
    await GET(createRequest())
    expect(findMock).toHaveBeenCalledTimes(2)
  })
})
