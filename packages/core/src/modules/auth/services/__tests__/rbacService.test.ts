import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { User, UserRole, RoleAcl, UserAcl, Role } from '@open-mercato/core/modules/auth/data/entities'

// Minimal mock of MikroORM EntityManager surface used by RbacService
type MockEm = {
  findOne: jest.Mock<any, any>
  find: jest.Mock<any, any>
}

function createMockEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
  }
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
})


