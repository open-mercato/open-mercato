import { createMemoryStrategy } from '@open-mercato/cache'
import type { Module } from '@open-mercato/shared/modules/registry'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import {
  createTenantModuleAvailability,
  resetTenantModuleAvailabilityStateForTests,
  type TenantModuleAvailability,
  type TenantModuleAvailabilityProvider,
} from '@open-mercato/shared/security/tenantModuleAvailability'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: jest.fn(),
}))

const mockGetModules = jest.mocked(getModules)

const modules: Module[] = [
  {
    id: 'auth',
    features: [
      { id: 'auth.users.view', title: 'View users', module: 'auth' },
    ],
  },
  {
    id: 'sales',
    features: [
      { id: 'sales.orders.view', title: 'View orders', module: 'sales' },
      { id: 'sales.orders.manage', title: 'Manage orders', module: 'sales' },
    ],
  },
]

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

type MockEm = {
  findOne: jest.Mock
  find: jest.Mock
  fork: jest.Mock
}

function createMockEm(): MockEm {
  const em: MockEm = { findOne: jest.fn(), find: jest.fn(), fork: jest.fn() }
  em.fork.mockReturnValue(em)
  return em
}

function createProvider(): TenantModuleAvailabilityProvider & { getUnavailableModuleIds: jest.Mock } {
  return {
    governedModuleIds: ['sales'],
    getUnavailableModuleIds: jest.fn(async ({ tenantId }: { tenantId: string }) => (
      tenantId === TENANT_A ? ['sales'] : []
    )),
  }
}

type Principal = {
  userId: string
  homeTenantId: string | null
  userAcl?: { isSuperAdmin: boolean; featuresJson: string[]; organizationsJson: string[] | null }
  roleAcls?: Array<{ isSuperAdmin?: boolean; featuresJson: string[]; organizationsJson: string[] | null }>
}

function wirePrincipal(em: MockEm, principal: Principal) {
  const role: Partial<Role> = { id: `${principal.userId}-role` }
  em.findOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === User && where?.id === principal.userId) {
      return { id: principal.userId, tenantId: principal.homeTenantId, organizationId: null }
    }
    if (entity === UserAcl && where?.isSuperAdmin === true) {
      return principal.userAcl?.isSuperAdmin ? principal.userAcl : null
    }
    if (entity === UserAcl && where?.user === principal.userId) return principal.userAcl ?? null
    return null
  })
  em.find.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === UserRole && where?.user === principal.userId) {
      return principal.roleAcls?.length ? [{ role }] : []
    }
    if (entity === RoleAcl) {
      return (principal.roleAcls ?? []).map((acl) => ({
        role,
        tenantId: where?.tenantId,
        isSuperAdmin: acl.isSuperAdmin === true,
        featuresJson: acl.featuresJson,
        organizationsJson: acl.organizationsJson,
      }))
    }
    return []
  })
}

describe('RbacService per-tenant module availability', () => {
  let em: MockEm
  let provider: ReturnType<typeof createProvider>
  let availability: TenantModuleAvailability

  const createService = (withAvailability = true) => new RbacService(
    em as never,
    createMemoryStrategy(),
    undefined,
    withAvailability ? availability : undefined,
  )

  beforeEach(() => {
    resetTenantModuleAvailabilityStateForTests()
    mockGetModules.mockReturnValue(modules)
    em = createMockEm()
    provider = createProvider()
    availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  const rolePrincipal: Principal = {
    userId: 'role-user',
    homeTenantId: TENANT_A,
    roleAcls: [{ featuresJson: ['sales.*', 'auth.users.view'], organizationsJson: null }],
  }

  it('is inert without a provider', async () => {
    wirePrincipal(em, rolePrincipal)
    const service = createService(false)

    await expect(service.userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], {
      tenantId: TENANT_A,
      organizationId: null,
    })).resolves.toBe(true)
    await expect(service.getEffectiveFeatures(rolePrincipal.userId, { tenantId: TENANT_A, organizationId: null }))
      .resolves.toEqual(['auth.users.view', 'sales.orders.view', 'sales.orders.manage'])
    expect(provider.getUnavailableModuleIds).not.toHaveBeenCalled()
  })

  it('denies a module only in the tenant where it is unavailable for the same grants', async () => {
    wirePrincipal(em, rolePrincipal)
    const service = createService()

    await expect(service.userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], {
      tenantId: TENANT_A,
      organizationId: null,
    })).resolves.toBe(false)
    await expect(service.userHasAllFeatures(rolePrincipal.userId, ['auth.users.view'], {
      tenantId: TENANT_A,
      organizationId: null,
    })).resolves.toBe(true)
    await expect(service.userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], {
      tenantId: TENANT_B,
      organizationId: null,
    })).resolves.toBe(true)
  })

  it('evaluates the principal home tenant when the check carries no tenant', async () => {
    wirePrincipal(em, rolePrincipal)
    const service = createService()

    await expect(service.userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], {
      tenantId: null,
      organizationId: null,
    })).resolves.toBe(false)
    expect(provider.getUnavailableModuleIds).toHaveBeenCalledWith({ tenantId: TENANT_A })
  })

  it('leaves a tenantless super admin evaluated without a tenant unrestricted and never asks the provider', async () => {
    const systemAdmin: Principal = {
      userId: 'system-admin',
      homeTenantId: null,
      userAcl: { isSuperAdmin: true, featuresJson: [], organizationsJson: null },
    }
    wirePrincipal(em, systemAdmin)
    const service = createService()

    await expect(service.userHasAllFeatures(systemAdmin.userId, ['sales.orders.view'], {
      tenantId: null,
      organizationId: null,
    })).resolves.toBe(true)
    expect(provider.getUnavailableModuleIds).not.toHaveBeenCalled()
  })

  it('denies wildcard and super-admin grants in the restricted tenant', async () => {
    const wildcardPrincipal: Principal = {
      userId: 'wildcard-user',
      homeTenantId: TENANT_A,
      userAcl: { isSuperAdmin: false, featuresJson: ['*'], organizationsJson: null },
    }
    wirePrincipal(em, wildcardPrincipal)
    const wildcardService = createService()
    await expect(wildcardService.userHasAllFeatures(wildcardPrincipal.userId, ['sales.orders.view'], {
      tenantId: TENANT_A,
      organizationId: null,
    })).resolves.toBe(false)

    const superAdmin: Principal = {
      userId: 'super-admin',
      homeTenantId: TENANT_B,
      userAcl: { isSuperAdmin: true, featuresJson: [], organizationsJson: null },
    }
    wirePrincipal(em, superAdmin)
    const superAdminService = createService()
    await expect(superAdminService.userHasAllFeatures(superAdmin.userId, ['sales.orders.view'], {
      tenantId: TENANT_A,
      organizationId: null,
    })).resolves.toBe(false)
    await expect(superAdminService.userHasAllFeatures(superAdmin.userId, ['sales.orders.view'], {
      tenantId: TENANT_B,
      organizationId: null,
    })).resolves.toBe(true)
    await expect(superAdminService.userHasAllFeatures(superAdmin.userId, ['auth.users.view'], {
      tenantId: TENANT_A,
      organizationId: null,
    })).resolves.toBe(true)
  })

  it('removes the module from effective features used by navigation and capability payloads', async () => {
    wirePrincipal(em, rolePrincipal)
    const service = createService()

    await expect(service.getEffectiveFeatures(rolePrincipal.userId, { tenantId: TENANT_A, organizationId: null }))
      .resolves.toEqual(['auth.users.view'])
    await expect(service.getEffectiveFeatures(rolePrincipal.userId, { tenantId: TENANT_B, organizationId: null }))
      .resolves.toEqual(['auth.users.view', 'sales.orders.view', 'sales.orders.manage'])
  })

  it('removes the module from super-admin effective features in the restricted tenant', async () => {
    const superAdmin: Principal = {
      userId: 'super-admin',
      homeTenantId: TENANT_B,
      userAcl: { isSuperAdmin: true, featuresJson: [], organizationsJson: null },
    }
    wirePrincipal(em, superAdmin)
    const service = createService()

    await expect(service.getEffectiveFeatures(superAdmin.userId, { tenantId: TENANT_A, organizationId: null }))
      .resolves.toEqual(['auth.users.view'])
  })

  it('removes the module from infrastructure grants consumed by interceptors, enrichers and guards', async () => {
    wirePrincipal(em, rolePrincipal)
    const service = createService()

    await expect(service.getGrantedFeatures(rolePrincipal.userId, { tenantId: TENANT_A, organizationId: null }))
      .resolves.toEqual(['auth.users.view'])
    await expect(service.getGrantedFeatures(rolePrincipal.userId, { tenantId: TENANT_B, organizationId: null }))
      .resolves.toEqual(['sales.*', 'auth.users.view'])
  })

  it('denies tenant-level feature checks used by background runtimes', async () => {
    wirePrincipal(em, rolePrincipal)
    em.find.mockImplementation(async (entity: unknown) => (
      entity === RoleAcl
        ? [{ isSuperAdmin: true, featuresJson: ['*'], organizationsJson: null }]
        : []
    ))
    const service = createService()

    await expect(service.tenantHasFeature(TENANT_A, 'sales.orders.view')).resolves.toBe(false)
    await expect(service.tenantHasFeature(TENANT_B, 'sales.orders.view')).resolves.toBe(true)
  })

  it('denies organization-scoped feature access in the restricted tenant', async () => {
    wirePrincipal(em, rolePrincipal)
    const service = createService()
    const candidates = [{ id: 'org-1', ancestorIds: [] }]

    const restricted = await service.resolveFeatureOrganizationAccess(rolePrincipal.userId, ['sales.orders.view'], {
      tenantId: TENANT_A,
    })
    expect(restricted.unrestricted).toBe(false)
    expect(restricted.filterOrganizationIds(candidates)).toEqual([])

    const allowed = await service.resolveFeatureOrganizationAccess(rolePrincipal.userId, ['sales.orders.view'], {
      tenantId: TENANT_B,
    })
    expect(allowed.unrestricted).toBe(true)
  })

  it('denies the global super-admin organization shortcut in the restricted tenant', async () => {
    const superAdmin: Principal = {
      userId: 'super-admin',
      homeTenantId: TENANT_B,
      userAcl: { isSuperAdmin: true, featuresJson: [], organizationsJson: null },
    }
    wirePrincipal(em, superAdmin)
    const service = createService()

    const access = await service.resolveFeatureOrganizationAccess(superAdmin.userId, ['sales.orders.view'], {
      tenantId: TENANT_A,
    })
    expect(access.unrestricted).toBe(false)
    expect(access.filterOrganizationIds([{ id: 'org-1', ancestorIds: [] }])).toEqual([])
  })

  it('applies the API key tenant when an API key check carries no tenant', async () => {
    const role: Partial<Role> = { id: 'key-role' }
    em.findOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === ApiKey && where?.id === 'key-1') {
        return { id: 'key-1', tenantId: TENANT_A, organizationId: null, rolesJson: ['key-role'], expiresAt: null }
      }
      return null
    })
    em.find.mockImplementation(async (entity: unknown) => (
      entity === RoleAcl
        ? [{ role, tenantId: TENANT_A, isSuperAdmin: false, featuresJson: ['sales.*'], organizationsJson: null }]
        : []
    ))
    const service = createService()

    await expect(service.userHasAllFeatures('api_key:key-1', ['sales.orders.view'], {
      tenantId: null,
      organizationId: null,
    })).resolves.toBe(false)
  })

  it('follows availability changes after explicit invalidation without touching the ACL cache', async () => {
    wirePrincipal(em, rolePrincipal)
    let unavailable = ['sales']
    provider.getUnavailableModuleIds.mockImplementation(async () => unavailable)
    const aclCache = createMemoryStrategy()
    const requestService = () => new RbacService(em as never, aclCache, undefined, availability)
    const scope = { tenantId: TENANT_A, organizationId: null }

    await expect(requestService().userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], scope)).resolves.toBe(false)
    unavailable = []
    await expect(requestService().userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], scope)).resolves.toBe(false)
    await availability.invalidate(TENANT_A)
    await expect(requestService().userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], scope)).resolves.toBe(true)
  })

  it('applies availability to transaction-bound replay authorization', async () => {
    wirePrincipal(em, rolePrincipal)
    const service = createService()
    jest.spyOn(service, 'loadAclWithEntityManager').mockResolvedValue({
      isSuperAdmin: true,
      features: ['*'],
      organizations: null,
    })
    const inTenant = (tenantId: string) => ({ tenantId, organizationId: null })

    await expect(service.userHasAllFeaturesWithEntityManager(em as never, 'admin', ['sales.orders.view'], inTenant(TENANT_A)))
      .resolves.toBe(false)
    await expect(service.userHasAllFeaturesWithEntityManager(em as never, 'admin', ['sales.orders.view'], inTenant(TENANT_B)))
      .resolves.toBe(true)
    await expect(service.getGrantedFeaturesWithEntityManager(em as never, 'admin', inTenant(TENANT_A)))
      .resolves.toEqual(['auth.*'])
  })

  it('lets a long-lived service follow an invalidation and, across processes, its one-second memo', async () => {
    wirePrincipal(em, rolePrincipal)
    let unavailable: string[] = []
    provider.getUnavailableModuleIds.mockImplementation(async () => unavailable)
    const longLived = createService()
    const scope = { tenantId: TENANT_A, organizationId: null }

    await expect(longLived.userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], scope)).resolves.toBe(true)
    unavailable = ['sales']
    await availability.invalidate(TENANT_A)
    await expect(longLived.userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], scope)).resolves.toBe(false)

    unavailable = []
    const otherProcessCache = createMemoryStrategy()
    const otherProcess = new RbacService(
      em as never,
      createMemoryStrategy(),
      undefined,
      createTenantModuleAvailability({ provider, cache: otherProcessCache }),
    )
    const nowSpy = jest.spyOn(Date, 'now')
    const start = Date.now()
    nowSpy.mockReturnValue(start)
    await expect(otherProcess.getUnavailableModuleIds(TENANT_A)).resolves.toEqual([])
    unavailable = ['sales']
    await otherProcessCache.deleteByTags(['tenant_module_availability:all'])
    await expect(otherProcess.getUnavailableModuleIds(TENANT_A)).resolves.toEqual([])
    nowSpy.mockReturnValue(start + 1_001)
    await expect(otherProcess.getUnavailableModuleIds(TENANT_A)).resolves.toEqual(['sales'])
    nowSpy.mockRestore()
  })

  it('bounds the per-instance tenant memo on long-lived services', async () => {
    const readSpy = jest.spyOn(availability, 'getUnavailableModuleIds')
    const longLived = createService()

    for (let tenant = 0; tenant < 300; tenant += 1) {
      await longLived.getUnavailableModuleIds(`tenant-${tenant}`)
    }
    readSpy.mockClear()
    await longLived.getUnavailableModuleIds('tenant-299')
    await longLived.getUnavailableModuleIds('tenant-0')

    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(readSpy).toHaveBeenCalledWith({ tenantId: 'tenant-0' })
  })

  it('does not keep a stale answer read while an invalidation was deleting the cached entry', async () => {
    const backingCache = createMemoryStrategy()
    let releaseDelete: () => void = () => undefined
    let pauseNextDelete = false
    const pausingCache = {
      get: (key: string) => backingCache.get(key),
      set: (key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) => backingCache.set(key, value, options),
      delete: (key: string) => backingCache.delete(key),
      deleteByTags: async (tags: string[]) => {
        if (pauseNextDelete) {
          pauseNextDelete = false
          await new Promise<void>((resolve) => {
            releaseDelete = resolve
          })
        }
        return backingCache.deleteByTags(tags)
      },
    }
    let unavailable = ['sales']
    provider.getUnavailableModuleIds.mockImplementation(async () => unavailable)
    const sharedAvailability = createTenantModuleAvailability({ provider, cache: pausingCache })
    const longLived = new RbacService(em as never, createMemoryStrategy(), undefined, sharedAvailability)

    await expect(longLived.getUnavailableModuleIds(TENANT_A)).resolves.toEqual(['sales'])
    unavailable = []
    pauseNextDelete = true
    const invalidation = sharedAvailability.invalidate(TENANT_A)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(longLived.getUnavailableModuleIds(TENANT_A)).resolves.toEqual(['sales'])
    releaseDelete()
    await invalidation

    await expect(longLived.getUnavailableModuleIds(TENANT_A)).resolves.toEqual([])
  })

  it('keeps recently used tenants in the bounded memo', async () => {
    const readSpy = jest.spyOn(availability, 'getUnavailableModuleIds')
    const longLived = createService()

    await longLived.getUnavailableModuleIds('tenant-hot')
    for (let tenant = 0; tenant < 255; tenant += 1) {
      await longLived.getUnavailableModuleIds(`tenant-${tenant}`)
      await longLived.getUnavailableModuleIds('tenant-hot')
    }
    await longLived.getUnavailableModuleIds('tenant-overflow')
    readSpy.mockClear()
    await longLived.getUnavailableModuleIds('tenant-hot')
    await longLived.getUnavailableModuleIds('tenant-0')

    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(readSpy).toHaveBeenCalledWith({ tenantId: 'tenant-0' })
  })

  it('reads the tenant availability once per request-scoped service', async () => {
    wirePrincipal(em, rolePrincipal)
    const readSpy = jest.spyOn(availability, 'getUnavailableModuleIds')
    const service = createService()
    const scope = { tenantId: TENANT_A, organizationId: null }

    for (let check = 0; check < 200; check += 1) {
      await service.userHasAllFeatures(rolePrincipal.userId, ['auth.users.view'], scope)
    }
    await service.getEffectiveFeatures(rolePrincipal.userId, scope)

    expect(readSpy).toHaveBeenCalledTimes(1)
  })

  it('exposes the unavailable module ids of a tenant for ACL snapshot consumers', async () => {
    const service = createService()

    await expect(service.getUnavailableModuleIds(TENANT_A)).resolves.toEqual(['sales'])
    await expect(service.getUnavailableModuleIds(TENANT_B)).resolves.toEqual([])
    await expect(service.getUnavailableModuleIds(null)).resolves.toEqual([])
    await expect(createService(false).getUnavailableModuleIds(TENANT_A)).resolves.toEqual([])
  })

  it('fails closed for governed modules when the provider fails', async () => {
    wirePrincipal(em, rolePrincipal)
    provider.getUnavailableModuleIds.mockRejectedValue(new Error('entitlement store offline'))
    const service = createService()

    await expect(service.userHasAllFeatures(rolePrincipal.userId, ['sales.orders.view'], {
      tenantId: TENANT_B,
      organizationId: null,
    })).resolves.toBe(false)
    await expect(service.userHasAllFeatures(rolePrincipal.userId, ['auth.users.view'], {
      tenantId: TENANT_B,
      organizationId: null,
    })).resolves.toBe(true)
  })
})
