import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { User, UserRole, RoleAcl, UserAcl, Role } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { createMemoryStrategy } from '@open-mercato/cache'
import type { CacheStrategy } from '@open-mercato/cache'
import * as enabledModulesRegistry from '@open-mercato/shared/security/enabledModulesRegistry'
import {
  applyAclFeatureOverrides,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'
import { buildOrgScopeUserCacheTag, buildOrgScopeTenantCacheTag } from '@open-mercato/core/modules/directory/utils/organizationScope'

// Minimal mock of MikroORM EntityManager surface used by RbacService
type MockEm = {
  findOne: jest.Mock<any, any>
  find: jest.Mock<any, any>
  fork: jest.Mock<any, any>
}

function createMockEm(): MockEm {
  const mockEm: MockEm = {
    findOne: jest.fn(),
    find: jest.fn(),
    fork: jest.fn(),
  }
  // fork() should return the same mock instance for testing purposes
  mockEm.fork.mockReturnValue(mockEm)
  return mockEm
}

describe('RbacService', () => {
  let em: MockEm
  let service: RbacService
  let cache: CacheStrategy
  let organizationHierarchyService: { resolveAncestorIds: jest.Mock }
  const callsForScopes = (scopeCount: number): number => {
    if (scopeCount <= 0) return 0
    return 3 + 2 * (scopeCount - 1)
  }
  const baseUser: Partial<User> = {
    id: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  beforeEach(() => {
    em = createMockEm()
    cache = createMemoryStrategy()
    organizationHierarchyService = { resolveAncestorIds: jest.fn().mockResolvedValue([]) }
    service = new RbacService(em as any, cache, organizationHierarchyService)
    jest.clearAllMocks()
  })

  afterEach(() => {
    resetModuleContractOverridesForTests()
    jest.restoreAllMocks()
  })

  describe('loadAcl', () => {
    it('returns empty ACL for unknown user', async () => {
      em.findOne.mockImplementation(async (entity: any) => {
        if (entity === User) return null
        return null
      })

      const acl = await service.loadAcl('missing', { tenantId: null, organizationId: null })
      expect(acl).toEqual({ isSuperAdmin: false, features: [], organizations: null })
    })

    it('prioritizes per-user ACL when present for tenant', async () => {
      const uacl: Partial<UserAcl> = {
        isSuperAdmin: false,
        featuresJson: ['entities.records.view', 'example.*'],
        organizationsJson: ['org-1', 'org-2'],
      }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) return uacl
        return null
      })

      const acl = await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(acl.isSuperAdmin).toBe(false)
      expect(acl.features.sort()).toEqual(['entities.records.view', 'example.*'])
      expect(acl.organizations).toEqual(['org-1', 'org-2'])
      expect(em.find).toHaveBeenCalledTimes(1)
    })

    it('preserves feature and organization correlation for scoped human-user role ACLs', async () => {
      const roleA: Partial<Role> = { id: 'role-a', name: 'admin' }
      const roleB: Partial<Role> = { id: 'role-b', name: 'employee' }
      const links: Array<Partial<UserRole>> = [
        { role: roleA as any },
        { role: roleB as any },
      ]
      const racls: Array<Partial<RoleAcl>> = [
        { role: roleA as any, tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['entities.*'], organizationsJson: ['org-1'] },
        { role: roleB as any, tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['example.todos.view'], organizationsJson: ['org-2'] },
      ]

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserRole && where?.user === baseUser.id) return links
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return racls
        return []
      })

      const acl = await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: 'org-2' })
      expect(acl.isSuperAdmin).toBe(false)
      expect(acl.features).toEqual(['example.todos.view'])
      expect(acl.organizations && new Set(acl.organizations)).toEqual(new Set(['org-1', 'org-2']))
      await expect(service.userHasAllFeatures(
        baseUser.id!,
        ['entities.records.view'],
        { tenantId: null, organizationId: 'org-2' },
      )).resolves.toBe(false)

      const tenantAcl = await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(tenantAcl.features.sort()).toEqual(['entities.*', 'example.todos.view'])
    })

    it('treats an empty role organization list as a deny-all scope for a human user (#4033)', async () => {
      const roleA: Partial<Role> = { id: 'role-a' }
      const links: Array<Partial<UserRole>> = [{ role: roleA as any }]
      const racls: Array<Partial<RoleAcl>> = [
        { role: roleA as any, tenantId: 'tenant-1', featuresJson: ['entities.records.view'], organizationsJson: [] },
      ]

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserRole && where?.user === baseUser.id) return links
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return racls
        return []
      })

      const acl = await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: 'org-3' })
      // The role's features still apply, but its empty organization allowlist must project
      // to an empty accessible set so scoped reads and deletes fail closed. Collapsing it to
      // null would mean "every organization" and reopen the scoped-deletion hole from #4033.
      expect(acl.organizations).toEqual([])
      expect(acl.features).toEqual(['entities.records.view'])
    })

    it('marks isSuperAdmin when any role ACL has isSuperAdmin=true', async () => {
      const roleA: Partial<Role> = { id: 'role-a' }
      const links: Array<Partial<UserRole>> = [{ role: roleA as any }]
      const racls: Array<Partial<RoleAcl>> = [
        { role: roleA as any, tenantId: 'tenant-1', isSuperAdmin: true, featuresJson: [] },
      ]

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserRole && where?.user === baseUser.id) return links
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return racls
        return []
      })

      const acl = await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(acl.isSuperAdmin).toBe(true)
    })

    it('does not apply a role-level super-admin grant outside its organization', async () => {
      const roleA: Partial<Role> = { id: 'role-a' }
      const roleB: Partial<Role> = { id: 'role-b' }
      const links: Array<Partial<UserRole>> = [{ role: roleA as any }, { role: roleB as any }]
      const racls: Array<Partial<RoleAcl>> = [
        { role: roleA as any, tenantId: 'tenant-1', isSuperAdmin: true, featuresJson: [], organizationsJson: ['org-1'] },
        { role: roleB as any, tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['documents.view'], organizationsJson: ['org-2'] },
      ]
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserRole && where?.user === baseUser.id) return links
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return racls
        return []
      })

      await expect(service.loadAcl(baseUser.id!, {
        tenantId: 'tenant-1',
        organizationId: 'org-2',
      })).resolves.toEqual({
        isSuperAdmin: false,
        features: ['documents.view'],
        organizations: ['org-1', 'org-2'],
      })
    })

    it.each([
      ['null', null],
      ['empty', []],
      ['__all__', ['__all__']],
    ])('keeps a %s organization role-level super-admin global in scoped projections', async (_label, organizationsJson) => {
      const restrictedRole: Partial<Role> = { id: 'role-restricted' }
      const unrestrictedRole: Partial<Role> = { id: 'role-unrestricted' }
      const links: Array<Partial<UserRole>> = [
        { role: restrictedRole as any },
        { role: unrestrictedRole as any },
      ]
      const racls: Array<Partial<RoleAcl>> = [
        {
          role: restrictedRole as any,
          tenantId: 'tenant-1',
          isSuperAdmin: true,
          featuresJson: [],
          organizationsJson: ['org-1'],
        },
        {
          role: unrestrictedRole as any,
          tenantId: 'tenant-1',
          isSuperAdmin: true,
          featuresJson: [],
          organizationsJson,
        },
      ]
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserAcl && where?.isSuperAdmin) return null
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any) => {
        if (entity === UserRole) return links
        if (entity === RoleAcl) return racls
        return []
      })

      await expect(service.loadAcl(baseUser.id!, {
        tenantId: 'tenant-2',
        organizationId: 'org-2',
      })).resolves.toEqual({
        isSuperAdmin: true,
        features: ['*'],
        organizations: null,
      })
    })

    it('keeps an organization-bound API key restricted when its role grants all organizations', async () => {
      const key: Partial<ApiKey> = {
        id: 'key-org-bound',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        rolesJson: ['role-a'],
        deletedAt: null,
      }
      const roleAcl: Partial<RoleAcl> = {
        tenantId: 'tenant-1',
        isSuperAdmin: false,
        featuresJson: ['documents.manage'],
        organizationsJson: null,
      }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === ApiKey) return key
        return null
      })
      em.find.mockImplementation(async (entity: any) => entity === RoleAcl ? [roleAcl] : [])

      const acl = await service.loadAcl('api_key:key-org-bound', {
        tenantId: 'tenant-1',
        organizationId: 'org-2',
      })

      expect(acl).toEqual({
        isSuperAdmin: false,
        features: ['documents.manage'],
        organizations: ['org-1'],
      })
    })

    it('preserves feature and organization correlation for tenant-scoped API-key roles', async () => {
      const key: Partial<ApiKey> = {
        id: 'key-disjoint-roles',
        tenantId: 'tenant-1',
        organizationId: null,
        rolesJson: ['role-documents', 'role-org-access'],
        deletedAt: null,
      }
      const roleAcls: Array<Partial<RoleAcl>> = [
        {
          role: { id: 'role-documents' } as Role,
          tenantId: 'tenant-1',
          isSuperAdmin: false,
          featuresJson: ['documents.view'],
          organizationsJson: ['org-1'],
        },
        {
          role: { id: 'role-org-access' } as Role,
          tenantId: 'tenant-1',
          isSuperAdmin: false,
          featuresJson: ['example.todos.view'],
          organizationsJson: ['org-2'],
        },
      ]

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === ApiKey) return key
        return null
      })
      em.find.mockImplementation(async (entity: any) => entity === RoleAcl ? roleAcls : [])

      const scopedAcl = await service.loadAcl('api_key:key-disjoint-roles', {
        tenantId: 'tenant-1',
        organizationId: 'org-2',
      })
      expect(scopedAcl).toEqual({
        isSuperAdmin: false,
        features: ['example.todos.view'],
        organizations: ['org-1', 'org-2'],
      })
      await expect(service.userHasAllFeatures(
        'api_key:key-disjoint-roles',
        ['documents.view'],
        { tenantId: 'tenant-1', organizationId: 'org-2' },
      )).resolves.toBe(false)

      const tenantAcl = await service.loadAcl('api_key:key-disjoint-roles', {
        tenantId: 'tenant-1',
        organizationId: null,
      })
      expect(tenantAcl).toEqual({
        isSuperAdmin: false,
        features: ['documents.view', 'example.todos.view'],
        organizations: ['org-1', 'org-2'],
      })
    })

    it('applies a parent-scoped role to a selected descendant for human users', async () => {
      const role: Partial<Role> = { id: 'role-parent' }
      const links: Array<Partial<UserRole>> = [{ role: role as Role }]
      const roleAcl: Partial<RoleAcl> = {
        role: role as Role,
        tenantId: 'tenant-1',
        isSuperAdmin: false,
        featuresJson: ['documents.view'],
        organizationsJson: ['org-parent'],
      }
      organizationHierarchyService.resolveAncestorIds.mockResolvedValue(['org-parent'])
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any) => {
        if (entity === UserRole) return links
        if (entity === RoleAcl) return [roleAcl]
        return []
      })

      const scope = { tenantId: 'tenant-1', organizationId: 'org-child' }
      await expect(service.loadAcl(baseUser.id!, scope)).resolves.toEqual({
        isSuperAdmin: false,
        features: ['documents.view'],
        organizations: ['org-parent', 'org-child'],
      })
      await expect(service.userHasAllFeatures(baseUser.id!, ['documents.view'], scope)).resolves.toBe(true)
    })

    it('applies a parent-scoped role to an API key bound to the descendant', async () => {
      const key: Partial<ApiKey> = {
        id: 'key-child',
        tenantId: 'tenant-1',
        organizationId: 'org-child',
        rolesJson: ['role-parent'],
        deletedAt: null,
      }
      const roleAcl: Partial<RoleAcl> = {
        role: { id: 'role-parent' } as Role,
        tenantId: 'tenant-1',
        isSuperAdmin: false,
        featuresJson: ['documents.view'],
        organizationsJson: ['org-parent'],
      }
      organizationHierarchyService.resolveAncestorIds.mockResolvedValue(['org-parent'])
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === ApiKey) return key
        return null
      })
      em.find.mockImplementation(async (entity: any) => entity === RoleAcl ? [roleAcl] : [])

      const scope = { tenantId: 'tenant-1', organizationId: 'org-child' }
      await expect(service.loadAcl('api_key:key-child', scope)).resolves.toEqual({
        isSuperAdmin: false,
        features: ['documents.view'],
        organizations: ['org-child'],
      })
      await expect(service.userHasAllFeatures('api_key:key-child', ['documents.view'], scope)).resolves.toBe(true)
    })

    it('fails closed for a restricted role when the selected organization does not exist', async () => {
      const role: Partial<Role> = { id: 'role-restricted' }
      organizationHierarchyService.resolveAncestorIds.mockResolvedValue(null)
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any) => {
        if (entity === UserRole) return [{ role }]
        if (entity === RoleAcl) {
          return [{ role, featuresJson: ['documents.view'], organizationsJson: ['org-missing'] }]
        }
        return []
      })

      const scope = { tenantId: 'tenant-1', organizationId: 'org-missing' }
      await expect(service.userHasAllFeatures(baseUser.id!, ['documents.view'], scope)).resolves.toBe(false)
    })

    it('treats an empty role organization list as all-org visibility for an API key', async () => {
      const key: Partial<ApiKey> = {
        id: 'key-empty-organizations',
        tenantId: 'tenant-1',
        organizationId: null,
        rolesJson: ['role-a'],
        deletedAt: null,
      }
      const roleAcl: Partial<RoleAcl> = {
        tenantId: 'tenant-1',
        isSuperAdmin: false,
        featuresJson: ['documents.view'],
        organizationsJson: [],
      }
      em.findOne.mockImplementation(async (entity: any) => entity === ApiKey ? key : null)
      em.find.mockImplementation(async (entity: any) => entity === RoleAcl ? [roleAcl] : [])

      await expect(service.loadAcl('api_key:key-empty-organizations', {
        tenantId: 'tenant-1',
        organizationId: 'org-2',
      })).resolves.toEqual({
        isSuperAdmin: false,
        features: ['documents.view'],
        organizations: null,
      })
    })

    it('applies role organization restrictions to a tenant-scoped API key', async () => {
      const key: Partial<ApiKey> = {
        id: 'key-tenant-bound',
        tenantId: 'tenant-1',
        organizationId: null,
        rolesJson: ['role-a'],
        deletedAt: null,
      }
      const roleAcl: Partial<RoleAcl> = {
        tenantId: 'tenant-1',
        isSuperAdmin: false,
        featuresJson: ['documents.manage'],
        organizationsJson: ['org-1'],
      }

      em.findOne.mockImplementation(async (entity: any) => entity === ApiKey ? key : null)
      em.find.mockImplementation(async (entity: any) => entity === RoleAcl ? [roleAcl] : [])

      const acl = await service.loadAcl('api_key:key-tenant-bound', {
        tenantId: 'tenant-1',
        organizationId: 'org-2',
      })

      expect(acl).toEqual({
        isSuperAdmin: false,
        features: [],
        organizations: ['org-1'],
      })
    })

    it('returns no organization access when key and role bounds do not overlap', async () => {
      const key: Partial<ApiKey> = {
        id: 'key-no-overlap',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        rolesJson: ['role-a'],
        deletedAt: null,
      }
      const roleAcl: Partial<RoleAcl> = {
        tenantId: 'tenant-1',
        isSuperAdmin: false,
        featuresJson: ['documents.manage'],
        organizationsJson: ['org-2'],
      }

      em.findOne.mockImplementation(async (entity: any) => entity === ApiKey ? key : null)
      em.find.mockImplementation(async (entity: any) => entity === RoleAcl ? [roleAcl] : [])

      const acl = await service.loadAcl('api_key:key-no-overlap', {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })

      expect(acl).toEqual({
        isSuperAdmin: false,
        features: [],
        organizations: [],
      })
    })

    it('does not let an API-key super-admin role bypass its organization bound', async () => {
      const key: Partial<ApiKey> = {
        id: 'key-org-super',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        rolesJson: ['role-a'],
        deletedAt: null,
      }
      const roleAcl: Partial<RoleAcl> = {
        tenantId: 'tenant-1',
        isSuperAdmin: true,
        featuresJson: [],
        organizationsJson: null,
      }

      em.findOne.mockImplementation(async (entity: any) => entity === ApiKey ? key : null)
      em.find.mockImplementation(async (entity: any) => entity === RoleAcl ? [roleAcl] : [])

      const acl = await service.loadAcl('api_key:key-org-super', {
        tenantId: 'tenant-1',
        organizationId: 'org-2',
      })

      expect(acl).toEqual({
        isSuperAdmin: false,
        features: ['*'],
        organizations: ['org-1'],
      })
    })
  })

  describe('getGrantedFeatures', () => {
    it('returns user grants after enabled-module filtering', async () => {
      jest
        .spyOn(enabledModulesRegistry, 'filterGrantsByEnabledModules')
        .mockImplementation((granted) => granted.filter((feature) => !feature.startsWith('search.')))

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          return {
            isSuperAdmin: false,
            featuresJson: ['wms.view', 'search.global'],
            organizationsJson: null,
          }
        }
        return null
      })

      const granted = await service.getGrantedFeatures(baseUser.id!, { tenantId: null, organizationId: null })
      expect(enabledModulesRegistry.filterGrantsByEnabledModules).toHaveBeenCalledWith(['wms.view', 'search.global'])
      expect(granted).toEqual(['wms.view'])
    })

    it('returns the union of role-aggregated grants after enabled-module filtering', async () => {
      const roleA: Partial<Role> = { id: 'role-a' }
      const roleB: Partial<Role> = { id: 'role-b' }
      const links: Array<Partial<UserRole>> = [{ role: roleA as any }, { role: roleB as any }]
      const racls: Array<Partial<RoleAcl>> = [
        { role: roleA as any, tenantId: 'tenant-1', featuresJson: ['entities.*'], organizationsJson: null },
        { role: roleB as any, tenantId: 'tenant-1', featuresJson: ['example.todos.view'], organizationsJson: null },
      ]
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserRole && where?.user === baseUser.id) return links
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return racls
        return []
      })

      const grants = await service.getGrantedFeatures(baseUser.id!, { tenantId: null, organizationId: null })
      expect(grants.sort()).toEqual(['entities.*', 'example.todos.view'])
    })

    it('passes ["*"] through filterGrantsByEnabledModules for super admin users', async () => {
      jest
        .spyOn(enabledModulesRegistry, 'filterGrantsByEnabledModules')
        .mockReturnValue(['auth.*', 'wms.*'])

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          return { isSuperAdmin: true, featuresJson: [] }
        }
        return null
      })

      const granted = await service.getGrantedFeatures(baseUser.id!, { tenantId: null, organizationId: null })
      expect(enabledModulesRegistry.filterGrantsByEnabledModules).toHaveBeenCalledWith(['*'])
      expect(granted).toEqual(['auth.*', 'wms.*'])
    })

    it('returns [] when the requested organization is outside the user restricted list', async () => {
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          return {
            isSuperAdmin: false,
            featuresJson: ['wms.view'],
            organizationsJson: ['org-1'],
          }
        }
        return null
      })

      const granted = await service.getGrantedFeatures(baseUser.id!, { tenantId: null, organizationId: 'org-2' })
      expect(granted).toEqual([])
    })

    it('returns [] for unknown users', async () => {
      em.findOne.mockImplementation(async () => null)
      const granted = await service.getGrantedFeatures('missing', { tenantId: null, organizationId: null })
      expect(granted).toEqual([])
    })

    it('returns filtered features for api_key users via role ACL aggregation', async () => {
      jest
        .spyOn(enabledModulesRegistry, 'filterGrantsByEnabledModules')
        .mockImplementation((grants) => grants.filter((f) => !f.startsWith('search.')))

      const apiKeyId = 'key-abc'
      const apiKey: Partial<ApiKey> = {
        id: apiKeyId,
        tenantId: 'tenant-1',
        organizationId: null,
        rolesJson: ['role-x'],
        expiresAt: null,
        deletedAt: null,
      }
      const racl: Partial<RoleAcl> = {
        tenantId: 'tenant-1',
        isSuperAdmin: false,
        featuresJson: ['wms.view', 'search.global'],
        organizationsJson: null,
      }

      em.findOne.mockImplementation(async (entity: any) => {
        if (entity === ApiKey) return apiKey
        return null
      })
      em.find.mockImplementation(async (entity: any) => {
        if (entity === RoleAcl) return [racl]
        return []
      })

      const granted = await service.getGrantedFeatures(`api_key:${apiKeyId}`, { tenantId: null, organizationId: null })
      expect(granted).toEqual(['wms.view'])
    })
  })

  describe('tenantHasFeature', () => {
    it('returns false without a tenant id', async () => {
      const ok = await service.tenantHasFeature(null, 'data_sync.run')

      expect(ok).toBe(false)
      expect(em.find).not.toHaveBeenCalled()
    })

    it('matches role ACL grants with wildcard semantics for scheduler feature checks', async () => {
      const roleAcls: Array<Partial<RoleAcl>> = [
        { tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['data_sync.*'], organizationsJson: null },
      ]

      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return roleAcls
        return []
      })

      const ok = await service.tenantHasFeature('tenant-1', 'data_sync.run', { organizationId: 'org-1' })

      expect(ok).toBe(true)
      expect(em.find).toHaveBeenCalledWith(RoleAcl, { tenantId: 'tenant-1', deletedAt: null }, {})
    })

    it('returns true when an in-scope role ACL is marked super admin', async () => {
      const roleAcls: Array<Partial<RoleAcl>> = [
        { tenantId: 'tenant-1', isSuperAdmin: true, featuresJson: [], organizationsJson: ['org-1'] },
      ]

      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return roleAcls
        return []
      })
      const ok = await service.tenantHasFeature('tenant-1', 'data_sync.run', { organizationId: 'org-1' })

      expect(ok).toBe(true)
    })

    it('honors parent organization grants for a selected descendant', async () => {
      const roleAcls: Array<Partial<RoleAcl>> = [
        { tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['data_sync.*'], organizationsJson: ['org-parent'] },
      ]
      organizationHierarchyService.resolveAncestorIds.mockResolvedValue(['org-parent'])
      em.find.mockImplementation(async (entity: any) => entity === RoleAcl ? roleAcls : [])

      await expect(service.tenantHasFeature(
        'tenant-1',
        'data_sync.run',
        { organizationId: 'org-child' },
      )).resolves.toBe(true)
    })

    it('denies a nulled tenant feature before wildcard and super-admin grants', async () => {
      applyAclFeatureOverrides({ 'data_sync.run': null })
      const roleAcls: Array<Partial<RoleAcl>> = [
        { tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['data_sync.*'], organizationsJson: null },
        { tenantId: 'tenant-1', isSuperAdmin: true, featuresJson: [], organizationsJson: null },
      ]
      em.find.mockResolvedValue(roleAcls)

      await expect(service.tenantHasFeature('tenant-1', 'data_sync.run')).resolves.toBe(false)
    })

    it('honors organization restrictions on role ACLs', async () => {
      const roleAcls: Array<Partial<RoleAcl>> = [
        { tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['data_sync.*'], organizationsJson: ['org-1'] },
      ]

      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return roleAcls
        return []
      })

      const ok = await service.tenantHasFeature('tenant-1', 'data_sync.run', { organizationId: 'org-2' })

      expect(ok).toBe(false)
    })

    it('drops grants from disabled modules before evaluating tenant features', async () => {
      jest
        .spyOn(enabledModulesRegistry, 'filterGrantsByEnabledModules')
        .mockImplementation((granted) => granted.filter((feature) => !feature.startsWith('data_sync.')))

      const roleAcls: Array<Partial<RoleAcl>> = [
        { tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['data_sync.*'], organizationsJson: null },
      ]

      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return roleAcls
        return []
      })

      const ok = await service.tenantHasFeature('tenant-1', 'data_sync.run')

      expect(ok).toBe(false)
      expect(enabledModulesRegistry.filterGrantsByEnabledModules).toHaveBeenCalledWith(['data_sync.*'])
    })
  })

  describe('userHasAllFeatures', () => {
    it.each([
      { acl: { isSuperAdmin: false, features: ['example.manage'], organizations: null } },
      { acl: { isSuperAdmin: false, features: ['example.*'], organizations: null } },
      { acl: { isSuperAdmin: true, features: [], organizations: null } },
    ])('denies a removed feature for explicit, wildcard, and superadmin staff subjects', async ({ acl }) => {
      applyAclFeatureOverrides({ 'example.manage': null })
      jest.spyOn(service, 'loadAcl').mockResolvedValue(acl)

      await expect(service.userHasAllFeatures(
        baseUser.id!,
        ['example.manage'],
        { tenantId: 'tenant-1', organizationId: 'org-1' },
      )).resolves.toBe(false)
    })

    it('keeps an unaffected sibling staff feature authorized', async () => {
      applyAclFeatureOverrides({ 'example.manage': null })
      jest.spyOn(service, 'loadAcl').mockResolvedValue({
        isSuperAdmin: false,
        features: ['example.*'],
        organizations: null,
      })

      await expect(service.userHasAllFeatures(
        baseUser.id!,
        ['example.view'],
        { tenantId: 'tenant-1', organizationId: 'org-1' },
      )).resolves.toBe(true)
    })

    it('returns true when no required features', async () => {
      const ok = await service.userHasAllFeatures('any', [], { tenantId: null, organizationId: null })
      expect(ok).toBe(true)
    })

    it('returns true for super admin user', async () => {
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          const uacl: Partial<UserAcl> = { isSuperAdmin: true, featuresJson: [] }
          return uacl
        }
        return null
      })

      const ok = await service.userHasAllFeatures(baseUser.id!, ['anything.here'], { tenantId: null, organizationId: null })
      expect(ok).toBe(true)
    })

    it('returns false for super admin when the required feature belongs to a disabled module', async () => {
      jest.spyOn(enabledModulesRegistry, 'hasEnabledModulesRegistry').mockReturnValue(true)
      jest.spyOn(enabledModulesRegistry, 'getEnabledModuleIds').mockReturnValue(['auth'])

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          const uacl: Partial<UserAcl> = { isSuperAdmin: true, featuresJson: [] }
          return uacl
        }
        return null
      })

      const ok = await service.userHasAllFeatures(baseUser.id!, ['search.global'], { tenantId: null, organizationId: null })
      expect(ok).toBe(false)
    })

    it('keeps the super admin organization bypass while still enforcing enabled modules', async () => {
      jest.spyOn(enabledModulesRegistry, 'hasEnabledModulesRegistry').mockReturnValue(true)
      jest.spyOn(enabledModulesRegistry, 'getEnabledModuleIds').mockReturnValue(['auth'])

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          const uacl: Partial<UserAcl> = {
            isSuperAdmin: true,
            featuresJson: [],
            organizationsJson: ['org-2'],
          }
          return uacl
        }
        return null
      })

      const ok = await service.userHasAllFeatures(baseUser.id!, ['auth.users.list'], { tenantId: null, organizationId: 'org-1' })
      expect(ok).toBe(true)
    })

    it('checks wildcard "*" grants all', async () => {
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          const uacl: Partial<UserAcl> = { isSuperAdmin: false, featuresJson: ['*'] }
          return uacl
        }
        return null
      })

      const ok = await service.userHasAllFeatures(baseUser.id!, ['entities.definitions.manage', 'other.feature'], { tenantId: null, organizationId: null })
      expect(ok).toBe(true)
    })

    it('checks prefix wildcard like "entities.*"', async () => {
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          const uacl: Partial<UserAcl> = { isSuperAdmin: false, featuresJson: ['entities.*'] }
          return uacl
        }
        return null
      })

      const ok1 = await service.userHasAllFeatures(baseUser.id!, ['entities.records.view'], { tenantId: null, organizationId: null })
      const ok2 = await service.userHasAllFeatures(baseUser.id!, ['entities'], { tenantId: null, organizationId: null })
      const ok3 = await service.userHasAllFeatures(baseUser.id!, ['auth.users.list'], { tenantId: null, organizationId: null })
      expect(ok1).toBe(true)
      expect(ok2).toBe(true)
      expect(ok3).toBe(false)
    })

    it('returns false when organization not included in restricted list', async () => {
      const roleA: Partial<Role> = { id: 'role-a' }
      const links: Array<Partial<UserRole>> = [{ role: roleA as any }]
      const racls: Array<Partial<RoleAcl>> = [
        { role: roleA as any, tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['entities.records.view'], organizationsJson: ['org-1'] },
      ]
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserRole && where?.user === baseUser.id) return links
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return racls
        return []
      })

      const ok = await service.userHasAllFeatures(baseUser.id!, ['entities.records.view'], { tenantId: null, organizationId: 'org-2' })
      expect(ok).toBe(false)
    })

    it('drops grants from disabled modules before evaluating non-superadmin permissions', async () => {
      jest
        .spyOn(enabledModulesRegistry, 'filterGrantsByEnabledModules')
        .mockImplementation((granted) => granted.filter((feature) => !feature.startsWith('search.')))

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          const uacl: Partial<UserAcl> = {
            isSuperAdmin: false,
            featuresJson: ['auth.*', 'search.global'],
            organizationsJson: null,
          }
          return uacl
        }
        return null
      })

      const canUseAuth = await service.userHasAllFeatures(baseUser.id!, ['auth.users.list'], { tenantId: null, organizationId: null })
      const canUseSearch = await service.userHasAllFeatures(baseUser.id!, ['search.global'], { tenantId: null, organizationId: null })

      expect(canUseAuth).toBe(true)
      expect(canUseSearch).toBe(false)
      expect(enabledModulesRegistry.filterGrantsByEnabledModules).toHaveBeenCalledWith(['auth.*', 'search.global'])
    })

    it('ignores organization restriction when any role grants all-org visibility (organizations=null)', async () => {
      const roleA: Partial<Role> = { id: 'role-a' }
      const links: Array<Partial<UserRole>> = [{ role: roleA as any }]
      const racls: Array<Partial<RoleAcl>> = [
        { role: roleA as any, tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['entities.records.view'], organizationsJson: null },
      ]
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserRole && where?.user === baseUser.id) return links
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return racls
        return []
      })

      const ok = await service.userHasAllFeatures(baseUser.id!, ['entities.records.view'], { tenantId: null, organizationId: 'org-unknown' })
      expect(ok).toBe(true)
    })
  })

  describe('resolveFeatureOrganizationAccess', () => {
    const organizations = [
      { id: 'org-1', ancestorIds: [] },
      { id: 'org-2', ancestorIds: [] },
    ]

    it('keeps only organizations where the required feature is granted', async () => {
      const unrestrictedRole: Partial<Role> = { id: 'role-unrestricted' }
      const riskRole: Partial<Role> = { id: 'role-risk' }
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any) => {
        if (entity === UserRole) return [
          { role: unrestrictedRole },
          { role: riskRole },
        ]
        if (entity === RoleAcl) return [
          {
            role: unrestrictedRole,
            featuresJson: ['eudr.statements.view'],
            organizationsJson: null,
          },
          {
            role: riskRole,
            featuresJson: ['eudr.risk.view'],
            organizationsJson: ['org-1'],
          },
        ]
        return []
      })

      const access = await service.resolveFeatureOrganizationAccess(
        baseUser.id!,
        ['eudr.risk.view'],
        { tenantId: 'tenant-1' },
      )
      expect(access.unrestricted).toBe(false)
      expect(access.filterOrganizationIds(organizations)).toEqual(['org-1'])
    })

    it('preserves unrestricted access when every required feature is globally granted', async () => {
      const role: Partial<Role> = { id: 'role-global' }
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any) => {
        if (entity === UserRole) return [{ role }]
        if (entity === RoleAcl) return [{
          role,
          featuresJson: ['eudr.risk.view'],
          organizationsJson: null,
        }]
        return []
      })

      const access = await service.resolveFeatureOrganizationAccess(
        baseUser.id!,
        ['eudr.risk.view'],
        { tenantId: 'tenant-1' },
      )
      expect(access.unrestricted).toBe(true)
      expect(access.filterOrganizationIds(organizations)).toEqual(['org-1', 'org-2'])
    })

    it('honors parent organization grants for descendant candidates', async () => {
      const role: Partial<Role> = { id: 'role-parent' }
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any) => {
        if (entity === UserRole) return [{ role }]
        if (entity === RoleAcl) return [{
          role,
          featuresJson: ['eudr.risk.view'],
          organizationsJson: ['org-parent'],
        }]
        return []
      })

      const access = await service.resolveFeatureOrganizationAccess(
        baseUser.id!,
        ['eudr.risk.view'],
        {
          tenantId: 'tenant-1',
        },
      )
      expect(access.unrestricted).toBe(false)
      expect(access.filterOrganizationIds([
        { id: 'org-parent', ancestorIds: [] },
        { id: 'org-child', ancestorIds: ['org-parent'] },
        { id: 'org-sibling', ancestorIds: [] },
      ])).toEqual(['org-parent', 'org-child'])
    })

    it('requires every feature to be granted in the same organization', async () => {
      const roleA: Partial<Role> = { id: 'role-a' }
      const roleB: Partial<Role> = { id: 'role-b' }
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any) => {
        if (entity === UserRole) return [{ role: roleA }, { role: roleB }]
        if (entity === RoleAcl) return [
          { role: roleA, featuresJson: ['feature.read'], organizationsJson: ['org-1'] },
          { role: roleB, featuresJson: ['feature.export'], organizationsJson: ['org-2'] },
        ]
        return []
      })

      const access = await service.resolveFeatureOrganizationAccess(
        baseUser.id!,
        ['feature.read', 'feature.export'],
        { tenantId: 'tenant-1' },
      )

      expect(access.unrestricted).toBe(false)
      expect(access.filterOrganizationIds(organizations)).toEqual([])
    })

    it('keeps a per-user ACL exclusive and organization-scoped', async () => {
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return {
          isSuperAdmin: false,
          featuresJson: ['eudr.risk.view'],
          organizationsJson: ['org-1'],
        }
        return null
      })

      const access = await service.resolveFeatureOrganizationAccess(
        baseUser.id!,
        ['eudr.risk.view'],
        { tenantId: 'tenant-1' },
      )

      expect(access.unrestricted).toBe(false)
      expect(access.filterOrganizationIds(organizations)).toEqual(['org-1'])
      expect(em.find).not.toHaveBeenCalledWith(
        UserRole,
        expect.objectContaining({ role: expect.anything() }),
        expect.anything(),
      )
    })

    it('keeps an empty-organization super-admin role globally authorized', async () => {
      const role: Partial<Role> = { id: 'role-super' }
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any) => {
        if (entity === UserRole) return [{ role }]
        if (entity === RoleAcl) return [{
          role,
          isSuperAdmin: true,
          featuresJson: [],
          organizationsJson: [],
        }]
        return []
      })

      const access = await service.resolveFeatureOrganizationAccess(
        baseUser.id!,
        ['eudr.risk.view'],
        { tenantId: 'tenant-1' },
      )

      expect(access.unrestricted).toBe(true)
      expect(access.filterOrganizationIds(organizations)).toEqual(['org-1', 'org-2'])
    })

    it('preserves the existing cross-tenant global super-admin shortcut', async () => {
      const globalSuperAcl = {
        isSuperAdmin: true,
        featuresJson: [],
        organizationsJson: null,
      }
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserAcl && where?.isSuperAdmin === true) return globalSuperAcl
        return null
      })

      const access = await service.resolveFeatureOrganizationAccess(
        baseUser.id!,
        ['eudr.risk.view'],
        { tenantId: 'another-tenant' },
      )

      expect(access.unrestricted).toBe(true)
      expect(access.filterOrganizationIds(organizations)).toEqual(['org-1', 'org-2'])
    })

    it('keeps an organization-bound API key inside its exact key scope', async () => {
      const key: Partial<ApiKey> = {
        id: 'key-org-bound',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        rolesJson: ['role-global'],
        deletedAt: null,
      }
      em.findOne.mockImplementation(async (entity: any) => entity === ApiKey ? key : null)
      em.find.mockImplementation(async (entity: any) => entity === RoleAcl ? [{
        featuresJson: ['eudr.risk.view'],
        organizationsJson: null,
      }] : [])

      const access = await service.resolveFeatureOrganizationAccess(
        'api_key:key-org-bound',
        ['eudr.risk.view'],
        { tenantId: 'tenant-1' },
      )

      expect(access.unrestricted).toBe(false)
      expect(access.filterOrganizationIds([
        { id: 'org-1', ancestorIds: [] },
        { id: 'org-1-child', ancestorIds: ['org-1'] },
      ])).toEqual(['org-1'])
    })
  })

  describe('Cache behavior', () => {
    it('should cache ACL results and not query database on second call', async () => {
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id && where?.tenantId === baseUser.tenantId) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      const acl1 = await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      const acl2 = await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })

      expect(acl1).toEqual(acl2)
      expect(em.findOne).toHaveBeenCalledTimes(callsForScopes(1)) // First load triggers global + user + ACL lookups
    })

    it('invalidates scoped ACL projections with the Directory tenant scope tag', async () => {
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['documents.view'], organizationsJson: null }
        }
        return null
      })
      const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

      await service.loadAcl(baseUser.id!, scope)
      await service.loadAcl(baseUser.id!, scope)
      expect(em.findOne).toHaveBeenCalledTimes(3)

      await cache.deleteByTags!([buildOrgScopeTenantCacheTag('tenant-1')])
      await service.loadAcl(baseUser.id!, scope)

      expect(em.findOne).toHaveBeenCalledTimes(5)
    })

    it('should cache separately for different scopes (different tenants)', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl && where?.tenantId === 'tenant-1') {
          return { isSuperAdmin: false, featuresJson: ['tenant1.feature'], organizationsJson: null }
        }
        if (entity === UserAcl && where?.tenantId === 'tenant-2') {
          return { isSuperAdmin: false, featuresJson: ['tenant2.feature'], organizationsJson: null }
        }
        return null
      })

      const acl1 = await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: null })
      const acl2 = await service.loadAcl(user.id, { tenantId: 'tenant-2', organizationId: null })
      
      expect(acl1.features).toEqual(['tenant1.feature'])
      expect(acl2.features).toEqual(['tenant2.feature'])
      expect(em.findOne).toHaveBeenCalledTimes(callsForScopes(2)) // 3 queries on first scope, then 2 on next
    })

    it('should cache separately for different scopes (different organizations)', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      const acl1 = await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      const acl2 = await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-2' })
      
      expect(acl1).toEqual(acl2) // Same data
      expect(em.findOne).toHaveBeenCalledTimes(callsForScopes(2))
    })

    it('should maintain cache isolation between different users', async () => {
      const user1 = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      const user2 = { id: 'user-2', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user1.id) return user1
        if (entity === User && where?.id === user2.id) return user2
        if (entity === UserAcl && where?.user === user1.id) {
          return { isSuperAdmin: false, featuresJson: ['user1.feature'], organizationsJson: null }
        }
        if (entity === UserAcl && where?.user === user2.id) {
          return { isSuperAdmin: true, featuresJson: ['user2.feature'], organizationsJson: null }
        }
        return null
      })

      const acl1 = await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: null })
      const acl2 = await service.loadAcl(user2.id, { tenantId: 'tenant-1', organizationId: null })
      
      expect(acl1.isSuperAdmin).toBe(false)
      expect(acl1.features).toEqual(['user1.feature'])
      expect(acl2.isSuperAdmin).toBe(true)
      expect(acl2.features).toEqual(['*'])
    })

    it('should invalidate cache for specific user', async () => {
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      await service.invalidateUserCache(baseUser.id!)
      await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })

      expect(em.findOne).toHaveBeenCalledTimes(6) // Two loads of same scope -> 3 queries each
    })

    it('should invalidate all scopes for a user when invalidating user cache', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      // Load multiple scopes for same user
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-2' })
      await service.loadAcl(user.id, { tenantId: 'tenant-2', organizationId: 'org-1' })
      
      const callsAfterLoad = em.findOne.mock.calls.length
      
      // Verify cache is working
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterLoad) // No new calls
      
      // Invalidate user cache
      await service.invalidateUserCache(user.id)
      
      // All scopes should require fresh queries
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-2' })
      await service.loadAcl(user.id, { tenantId: 'tenant-2', organizationId: 'org-1' })
      
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterLoad + 7) // Global check once, then 3 scoped projections reload user + ACL
    })

    it('should not affect other users when invalidating specific user cache', async () => {
      const user1 = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      const user2 = { id: 'user-2', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user1.id) return user1
        if (entity === User && where?.id === user2.id) return user2
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: null })
      await service.loadAcl(user2.id, { tenantId: 'tenant-1', organizationId: null })
      
      const callsAfterLoad = em.findOne.mock.calls.length
      
      await service.invalidateUserCache(user1.id)
      
      // User1 should query again
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: null })
      expect(em.findOne.mock.calls.length).toBeGreaterThan(callsAfterLoad)
      
      const callsAfterUser1 = em.findOne.mock.calls.length
      
      // User2 should still be cached
      await service.loadAcl(user2.id, { tenantId: 'tenant-1', organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterUser1) // No new calls
    })

    it('should invalidate cache for all users in a tenant', async () => {
      const user1 = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      const user2 = { id: 'user-2', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user1.id) return user1
        if (entity === User && where?.id === user2.id) return user2
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: null })
      await service.loadAcl(user2.id, { tenantId: 'tenant-1', organizationId: null })
      
      const initialCalls = em.findOne.mock.calls.length
      
      await service.invalidateTenantCache('tenant-1')
      
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: null })
      await service.loadAcl(user2.id, { tenantId: 'tenant-1', organizationId: null })

      expect(em.findOne).toHaveBeenCalledTimes(initialCalls + callsForScopes(1) * 2) // Both users queried again (first load per user)
    })

    // Issue #2259 — the resolved OrganizationScope (directory) cache derives its
    // accessible-org set from the same ACL/role grants the RBAC cache holds.
    // RBAC invalidation must therefore also drop the matching org-scope entries,
    // so the cross-request scope TTL can be enabled without serving stale scope
    // after a membership change.
    it('invalidateUserCache also drops org-scope:user entries', async () => {
      const key = 'org-scope:user-1:tenant-1:none:none'
      const scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: 'tenant-1' }
      await cache.set(key, scope, { ttl: 60_000, tags: [buildOrgScopeUserCacheTag('user-1')] })
      expect(await cache.get(key)).not.toBeNull()

      await service.invalidateUserCache('user-1')

      expect(await cache.get(key)).toBeNull()
    })

    it('invalidateTenantCache also drops org-scope:tenant entries', async () => {
      const key = 'org-scope:user-9:tenant-1:none:none'
      const scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: 'tenant-1' }
      await cache.set(key, scope, { ttl: 60_000, tags: [buildOrgScopeTenantCacheTag('tenant-1')] })
      expect(await cache.get(key)).not.toBeNull()

      await service.invalidateTenantCache('tenant-1')

      expect(await cache.get(key)).toBeNull()
    })

    it('should not affect other tenants when invalidating specific tenant cache', async () => {
      const user1 = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      const user2 = { id: 'user-2', tenantId: 'tenant-2', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user1.id) return user1
        if (entity === User && where?.id === user2.id) return user2
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: null })
      await service.loadAcl(user2.id, { tenantId: 'tenant-2', organizationId: null })
      
      const callsAfterLoad = em.findOne.mock.calls.length
      
      await service.invalidateTenantCache('tenant-1')
      
      // Tenant-1 user should query again
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: null })
      expect(em.findOne.mock.calls.length).toBeGreaterThan(callsAfterLoad)
      
      const callsAfterTenant1 = em.findOne.mock.calls.length
      
      // Tenant-2 user should still be cached
      await service.loadAcl(user2.id, { tenantId: 'tenant-2', organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterTenant1) // No new calls
    })

    it('should handle invalidating tenant cache with null tenant entries', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      // Load with explicit tenant and with null tenant
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: null })
      await service.loadAcl(user.id, { tenantId: null, organizationId: null })
      
      const callsAfterLoad = em.findOne.mock.calls.length
      
      await service.invalidateTenantCache('tenant-1')
      
      // Tenant-1 entry should be invalidated
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: null })
      expect(em.findOne.mock.calls.length).toBeGreaterThan(callsAfterLoad)
      
      const callsAfterInvalidation = em.findOne.mock.calls.length
      
      // Null tenant entry should still be cached
      await service.loadAcl(user.id, { tenantId: null, organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterInvalidation) // No new calls
    })

    it('should invalidate cache for all users in an organization', async () => {
      const user1 = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user1.id) return user1
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      
      const initialCalls = em.findOne.mock.calls.length
      
      await service.invalidateOrganizationCache('org-1')
      
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: 'org-1' })

      expect(em.findOne).toHaveBeenCalledTimes(initialCalls + 2) // User queried again
    })

    it('should not affect other organizations when invalidating specific organization cache', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-2' })
      
      const callsAfterLoad = em.findOne.mock.calls.length
      
      await service.invalidateOrganizationCache('org-1')
      
      // Org-1 entry should query again
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      expect(em.findOne.mock.calls.length).toBeGreaterThan(callsAfterLoad)
      
      const callsAfterOrg1 = em.findOne.mock.calls.length
      
      // Org-2 entry should still be cached
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-2' })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterOrg1) // No new calls
    })

    it('should handle invalidating organization cache with null organization entries', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      // Load with explicit org and with null org
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: null })
      
      const callsAfterLoad = em.findOne.mock.calls.length
      
      await service.invalidateOrganizationCache('org-1')
      
      // Org-1 entry should be invalidated
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      expect(em.findOne.mock.calls.length).toBeGreaterThan(callsAfterLoad)
      
      const callsAfterInvalidation = em.findOne.mock.calls.length
      
      // Null org entry should still be cached
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterInvalidation) // No new calls
    })

    it('should invalidate all cache entries with invalidateAllCache', async () => {
      const user1 = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      const user2 = { id: 'user-2', tenantId: 'tenant-2', organizationId: 'org-2' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user1.id) return user1
        if (entity === User && where?.id === user2.id) return user2
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      // Load multiple cache entries
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: 'org-2' })
      await service.loadAcl(user2.id, { tenantId: 'tenant-2', organizationId: 'org-1' })
      await service.loadAcl(user2.id, { tenantId: 'tenant-2', organizationId: 'org-2' })
      
      const callsAfterLoad = em.findOne.mock.calls.length
      
      // Verify cache is working
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterLoad) // No new calls
      
      // Invalidate all cache
      await service.invalidateAllCache()
      
      // All entries should require fresh queries
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: 'org-2' })
      await service.loadAcl(user2.id, { tenantId: 'tenant-2', organizationId: 'org-1' })
      await service.loadAcl(user2.id, { tenantId: 'tenant-2', organizationId: 'org-2' })
      
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterLoad + 10) // Global check per user, then both users reload two scoped projections each
    })

    it('should handle invalidating non-existent user cache gracefully', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: null })
      
      // Should not throw
      await expect(service.invalidateUserCache('non-existent-user')).resolves.not.toThrow()
      
      // Original cache should still work
      const callsBeforeReload = em.findOne.mock.calls.length
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsBeforeReload) // No new calls
    })

    it('should handle invalidating non-existent tenant cache gracefully', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: null })
      
      // Should not throw
      await expect(service.invalidateTenantCache('non-existent-tenant')).resolves.not.toThrow()
      
      // Original cache should still work
      const callsBeforeReload = em.findOne.mock.calls.length
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsBeforeReload) // No new calls
    })

    it('should handle invalidating non-existent organization cache gracefully', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      
      // Should not throw
      await expect(service.invalidateOrganizationCache('non-existent-org')).resolves.not.toThrow()
      
      // Original cache should still work
      const callsBeforeReload = em.findOne.mock.calls.length
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      expect(em.findOne).toHaveBeenCalledTimes(callsBeforeReload) // No new calls
    })

    it('should respect cache TTL and refetch after expiration', async () => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
      const shortTtlCache = createMemoryStrategy()
      const shortTtlService = new RbacService(em as any, shortTtlCache)
      shortTtlService.setCacheTtl(100) // 100ms TTL
      
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await shortTtlService.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      const callsAfterFirst = em.findOne.mock.calls.length

      await shortTtlService.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterFirst) // Still cached

      await jest.advanceTimersByTimeAsync(150) // Wait for cache to expire

      await shortTtlService.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterFirst + 2) // Refetched (user + ACL queries)
      jest.useRealTimers()
    })

    it('should use custom TTL when configured via setCacheTtl', async () => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
      const customTtlCache = createMemoryStrategy()
      const customTtlService = new RbacService(em as any, customTtlCache)
      customTtlService.setCacheTtl(50) // 50ms TTL
      
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl) {
          return { isSuperAdmin: false, featuresJson: ['test.feature'], organizationsJson: null }
        }
        return null
      })

      await customTtlService.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      const callsAfterFirst = em.findOne.mock.calls.length

      // Should still be cached at 40ms
      await jest.advanceTimersByTimeAsync(40)
      await customTtlService.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterFirst)

      // Should expire after 60ms total
      await jest.advanceTimersByTimeAsync(25)
      await customTtlService.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterFirst + 2)
      jest.useRealTimers()
    })

    it('should cache empty ACL results for unknown users', async () => {
      em.findOne.mockImplementation(async (entity: any) => {
        if (entity === User) return null
        return null
      })

      await service.loadAcl('unknown-user', { tenantId: null, organizationId: null })
      const callsAfterFirst = em.findOne.mock.calls.length

      // Second call should be cached
      await service.loadAcl('unknown-user', { tenantId: null, organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterFirst) // No new calls
    })

    it('should properly cache complex role aggregations', async () => {
      const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      const roleA: Partial<Role> = { id: 'role-a' }
      const roleB: Partial<Role> = { id: 'role-b' }
      const links: Array<Partial<UserRole>> = [
        { role: roleA as any },
        { role: roleB as any },
      ]
      const racls: Array<Partial<RoleAcl>> = [
        { role: roleA as any, tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['feature1', 'feature2'], organizationsJson: ['org-1'] },
        { role: roleB as any, tenantId: 'tenant-1', isSuperAdmin: false, featuresJson: ['feature3'], organizationsJson: ['org-2'] },
      ]

      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === user.id) return user
        if (entity === UserAcl) return null
        return null
      })
      em.find.mockImplementation(async (entity: any, where: any) => {
        if (entity === UserRole && where?.user === user.id) return links
        if (entity === RoleAcl && where?.tenantId === 'tenant-1') return racls
        return []
      })

      const acl1 = await service.loadAcl(user.id, { tenantId: null, organizationId: null })
      const callsAfterFirst = em.findOne.mock.calls.length + em.find.mock.calls.length

      // Verify aggregation is correct
      expect(acl1.features.sort()).toEqual(['feature1', 'feature2', 'feature3'])
      expect(new Set(acl1.organizations || [])).toEqual(new Set(['org-1', 'org-2']))

      // Second call should be fully cached
      const acl2 = await service.loadAcl(user.id, { tenantId: null, organizationId: null })
      const callsAfterSecond = em.findOne.mock.calls.length + em.find.mock.calls.length
      
      expect(callsAfterSecond).toBe(callsAfterFirst) // No additional queries
      expect(acl2).toEqual(acl1)
    })

    it('should handle userHasAllFeatures with cached results', async () => {
      em.findOne.mockImplementation(async (entity: any, where: any) => {
        if (entity === User && where?.id === baseUser.id) return baseUser
        if (entity === UserAcl && where?.user === baseUser.id) {
          return { isSuperAdmin: false, featuresJson: ['test.feature', 'another.feature'], organizationsJson: null }
        }
        return null
      })

      // First call loads and caches
      const hasFeatures1 = await service.userHasAllFeatures(baseUser.id!, ['test.feature'], { tenantId: null, organizationId: null })
      const callsAfterFirst = em.findOne.mock.calls.length

      // Second call uses cache
      const hasFeatures2 = await service.userHasAllFeatures(baseUser.id!, ['another.feature'], { tenantId: null, organizationId: null })
      
      expect(hasFeatures1).toBe(true)
      expect(hasFeatures2).toBe(true)
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterFirst) // No new queries
    })
  })
})
