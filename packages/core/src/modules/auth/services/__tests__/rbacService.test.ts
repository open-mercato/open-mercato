import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { User, UserRole, RoleAcl, UserAcl, Role } from '@open-mercato/core/modules/auth/data/entities'

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

  const baseUser: Partial<User> = {
    id: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  beforeEach(() => {
    em = createMockEm()
    service = new RbacService(em as any)
    jest.clearAllMocks()
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
      expect(em.find).not.toHaveBeenCalled()
    })

    it('aggregates role ACLs when user ACL missing and tenant provided', async () => {
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
      // de-duplicated and union of features
      expect(acl.features.sort()).toEqual(['entities.*', 'example.todos.view'])
      // organizations become union; since neither role had null, it remains an array
      expect(acl.organizations && new Set(acl.organizations)).toEqual(new Set(['org-1', 'org-2']))
    })

    it('sets organizations to null if any role grants all-org visibility', async () => {
      const roleA: Partial<Role> = { id: 'role-a' }
      const links: Array<Partial<UserRole>> = [{ role: roleA as any }]
      const racls: Array<Partial<RoleAcl>> = [
        { role: roleA as any, tenantId: 'tenant-1', featuresJson: ['entities.records.view'], organizationsJson: null },
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
      expect(acl.organizations).toBeNull()
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
  })

  describe('userHasAllFeatures', () => {
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
      expect(em.findOne).toHaveBeenCalledTimes(2) // Only called for first request (User and UserAcl)
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
      expect(em.findOne).toHaveBeenCalledTimes(4) // 2 calls per scope (User + UserAcl)
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
      expect(em.findOne).toHaveBeenCalledTimes(4) // But cached separately (2 calls per scope)
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
      expect(acl2.features).toEqual(['user2.feature'])
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
      service.invalidateUserCache(baseUser.id!)
      await service.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })

      expect(em.findOne).toHaveBeenCalledTimes(4) // Called twice (2 queries per load)
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
      service.invalidateUserCache(user.id)
      
      // All scopes should require fresh queries
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-2' })
      await service.loadAcl(user.id, { tenantId: 'tenant-2', organizationId: 'org-1' })
      
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterLoad + 6) // 2 calls per scope
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
      
      service.invalidateUserCache(user1.id)
      
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
      
      service.invalidateTenantCache('tenant-1')
      
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: null })
      await service.loadAcl(user2.id, { tenantId: 'tenant-1', organizationId: null })

      expect(em.findOne).toHaveBeenCalledTimes(initialCalls + 4) // Both users queried again
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
      
      service.invalidateTenantCache('tenant-1')
      
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
      
      service.invalidateTenantCache('tenant-1')
      
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
      
      service.invalidateOrganizationCache('org-1')
      
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
      
      service.invalidateOrganizationCache('org-1')
      
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
      
      service.invalidateOrganizationCache('org-1')
      
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
      service.invalidateAllCache()
      
      // All entries should require fresh queries
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      await service.loadAcl(user1.id, { tenantId: 'tenant-1', organizationId: 'org-2' })
      await service.loadAcl(user2.id, { tenantId: 'tenant-2', organizationId: 'org-1' })
      await service.loadAcl(user2.id, { tenantId: 'tenant-2', organizationId: 'org-2' })
      
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterLoad + 8) // 2 calls per scope
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
      expect(() => service.invalidateUserCache('non-existent-user')).not.toThrow()
      
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
      expect(() => service.invalidateTenantCache('non-existent-tenant')).not.toThrow()
      
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
      expect(() => service.invalidateOrganizationCache('non-existent-org')).not.toThrow()
      
      // Original cache should still work
      const callsBeforeReload = em.findOne.mock.calls.length
      await service.loadAcl(user.id, { tenantId: 'tenant-1', organizationId: 'org-1' })
      expect(em.findOne).toHaveBeenCalledTimes(callsBeforeReload) // No new calls
    })

    it('should respect cache TTL and refetch after expiration', async () => {
      const shortTtlService = new RbacService(em as any, 100) // 100ms TTL
      
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

      await new Promise(resolve => setTimeout(resolve, 150)) // Wait for cache to expire

      await shortTtlService.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterFirst + 2) // Refetched
    })

    it('should use custom TTL when provided to constructor', async () => {
      const customTtlService = new RbacService(em as any, 50) // 50ms TTL
      
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
      await new Promise(resolve => setTimeout(resolve, 40))
      await customTtlService.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterFirst)

      // Should expire after 60ms total
      await new Promise(resolve => setTimeout(resolve, 25))
      await customTtlService.loadAcl(baseUser.id!, { tenantId: null, organizationId: null })
      expect(em.findOne).toHaveBeenCalledTimes(callsAfterFirst + 2)
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


