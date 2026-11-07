import { CustomerRoleAcl, CustomerUserAcl, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import {
  applyAclFeatureOverrides,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'

beforeAll(() => {
  registerModules([
    {
      id: 'customer_accounts',
      setup: {
        defaultCustomerRoleFeatures: {
          portal_admin: ['portal.*'],
          buyer: ['portal.orders.view', 'portal.account.manage'],
        },
      },
      frontendRoutes: [
        {
          Component: () => null,
          requireCustomerFeatures: ['portal.quotes.view'],
        },
      ],
    },
  ])
})

afterEach(() => {
  resetModuleContractOverridesForTests()
  jest.restoreAllMocks()
})

type MockEm = {
  findOne: jest.Mock
  find: jest.Mock
  fork: jest.Mock
}

function createMockEm(): MockEm {
  const em: MockEm = {
    findOne: jest.fn(),
    find: jest.fn(),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

describe('CustomerRbacService organization scope', () => {
  it('ignores pre-existing links to roles owned by another organization in the same tenant', async () => {
    const tenantId = 'tenant-1'
    const organizationId = 'org-a'
    const foreignOrganizationId = 'org-b'
    const userId = 'customer-user-1'
    const localRole = { id: 'role-local', tenantId, organizationId, deletedAt: null }
    const foreignRole = { id: 'role-foreign', tenantId, organizationId: foreignOrganizationId, deletedAt: null }
    const links = [{ role: localRole }, { role: foreignRole }]
    const em = createMockEm()

    em.findOne.mockImplementation(async (entity: unknown) => (
      entity === CustomerUserAcl ? null : null
    ))
    em.find.mockImplementation(async (entity: unknown, where: Record<string, any>) => {
      if (entity === CustomerUserRole) {
        return where.role?.organizationId === organizationId ? [links[0]] : links
      }
      if (entity === CustomerRoleAcl) {
        const requestedIds = where.role?.$in ?? []
        return [
          { role: localRole, tenantId, isPortalAdmin: false, featuresJson: ['portal.orders.view'] },
          { role: foreignRole, tenantId, isPortalAdmin: true, featuresJson: ['portal.users.manage'] },
        ].filter((acl) => requestedIds.includes(acl.role.id))
      }
      return []
    })

    const service = new CustomerRbacService(em as any)
    const acl = await service.loadAcl(userId, { tenantId, organizationId })

    expect(em.find).toHaveBeenCalledWith(
      CustomerUserRole,
      {
        user: userId,
        role: { tenantId, organizationId, deletedAt: null },
        deletedAt: null,
      },
      { populate: ['role'] },
    )
    expect(acl).toEqual({ isPortalAdmin: false, features: ['portal.orders.view'] })
  })
})

describe('CustomerRbacService feature policy', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

  it.each([
    { isPortalAdmin: false, features: ['portal.account.manage'] },
    { isPortalAdmin: false, features: ['portal.*'] },
    { isPortalAdmin: true, features: [] },
  ])('denies a removed feature for explicit, wildcard, and portal-admin subjects', async (acl) => {
    applyAclFeatureOverrides({ 'portal.account.manage': null })
    const service = new CustomerRbacService(createMockEm() as any)
    jest.spyOn(service, 'loadAcl').mockResolvedValue(acl)

    await expect(service.userHasAllFeatures(
      'customer-user-1',
      ['portal.account.manage'],
      scope,
    )).resolves.toBe(false)
  })

  it('keeps an active sibling feature authorized and projects concrete portal-admin features', async () => {
    applyAclFeatureOverrides({ 'portal.account.manage': null })
    const service = new CustomerRbacService(createMockEm() as any)
    jest.spyOn(service, 'loadAcl').mockResolvedValue({
      isPortalAdmin: true,
      features: [],
    })

    await expect(service.userHasAllFeatures(
      'customer-user-1',
      ['portal.orders.view'],
      scope,
    )).resolves.toBe(true)
    await expect(service.getEffectiveFeatures('customer-user-1', scope)).resolves.toEqual([
      'portal.orders.view',
      'portal.quotes.view',
    ])
  })
})

describe('CustomerRbacService cache tenant boundaries', () => {
  it('invalidates an ACL read by a portal request when a staff request changes its roles', async () => {
    const { createCacheService, runWithCacheTenant } = await import('@open-mercato/cache')
    const tenantId = 'customer-rbac-cache-tenant'
    const scope = { tenantId, organizationId: 'customer-rbac-cache-org' }
    const userId = 'customer-rbac-cache-user'
    const em = createMockEm()
    const cache = createCacheService({ strategy: 'memory' })
    let features = ['portal.account.view']
    em.findOne.mockResolvedValue(null)
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserRole) return [{ role: { id: 'role-cache' } }]
      if (entity === CustomerRoleAcl) return [{ isPortalAdmin: false, featuresJson: features }]
      return []
    })
    const service = new CustomerRbacService(em as unknown as import('@mikro-orm/postgresql').EntityManager, cache)

    expect(await runWithCacheTenant(null, () => service.loadAcl(userId, scope)))
      .toEqual({ isPortalAdmin: false, features: ['portal.account.view'] })
    features = ['portal.account.manage']
    await runWithCacheTenant(tenantId, () => service.invalidateUserCache(userId))

    expect(await runWithCacheTenant(null, () => service.loadAcl(userId, scope)))
      .toEqual({ isPortalAdmin: false, features: ['portal.account.manage'] })
  })
})

describe('CustomerRbacService explicit cache invalidation scope', () => {
  it.each(['user', 'role', 'tenant'] as const)('invalidates %s cache entries without clearing another tenant', async (invalidation) => {
    const { createCacheService, getCurrentCacheTenant, runWithCacheTenant } = await import('@open-mercato/cache')
    const scope = { tenantId: 'explicit-cache-tenant', organizationId: 'explicit-cache-org' }
    const userId = 'explicit-cache-user'
    const em = createMockEm()
    const cache = createCacheService({ strategy: 'memory' })
    let features = ['portal.account.view']
    em.findOne.mockResolvedValue(null)
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserRole) return [{ role: { id: 'explicit-cache-role' } }]
      if (entity === CustomerRoleAcl) return [{ isPortalAdmin: false, featuresJson: features }]
      return []
    })
    const service = new CustomerRbacService(em as unknown as import('@mikro-orm/postgresql').EntityManager, cache)
    await runWithCacheTenant('ambient-other-tenant', async () => {
      await service.loadAcl(userId, scope)
      expect(getCurrentCacheTenant()).toBe('ambient-other-tenant')
    })
    expect(await runWithCacheTenant(scope.tenantId, () => cache.keys())).toHaveLength(1)
    await runWithCacheTenant('unrelated-tenant', () => cache.set('sentinel', 'retained', {
      tags: ['customer_rbac:all', `customer_rbac:user:${userId}`, `customer_rbac:tenant:${scope.tenantId}`],
    }))
    features = ['portal.account.manage']
    await runWithCacheTenant(null, async () => {
      if (invalidation === 'user') await service.invalidateUserCache(userId, scope.tenantId)
      else if (invalidation === 'role') await service.invalidateRoleCache('explicit-cache-role', scope.tenantId)
      else await service.invalidateTenantCache(scope.tenantId)
      expect(getCurrentCacheTenant()).toBeNull()
    })
    expect(await service.loadAcl(userId, scope)).toEqual({ isPortalAdmin: false, features })
    expect(await runWithCacheTenant('unrelated-tenant', () => cache.get('sentinel'))).toBe('retained')
  })
})
