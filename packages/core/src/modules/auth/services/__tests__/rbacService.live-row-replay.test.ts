import type { EntityManager } from '@mikro-orm/postgresql'
import { createMemoryStrategy } from '@open-mercato/cache'
import { User, UserAcl, UserRole, RoleAcl } from '../../data/entities'
import { RbacService } from '../rbacService'

type Row = Record<string, unknown>

function matches(value: unknown, expected: unknown): boolean {
  if (expected === null) return value == null
  if (typeof expected !== 'object' || expected === null) {
    return value === expected
      || (typeof value === 'object' && value !== null && 'id' in value && value.id === expected)
  }
  if ('$in' in expected && Array.isArray(expected.$in)) {
    return expected.$in.some((candidate: unknown) => matches(value, candidate))
  }
  if (typeof value !== 'object' || value === null) return false
  const record = value as Row
  return Object.entries(expected).every(([key, expectedValue]) => matches(record[key], expectedValue))
}

function createFixture() {
  const user = { id: 'user-live', tenantId: 'tenant-own', organizationId: null }
  const role = { id: 'role-live', tenantId: 'tenant-own', deletedAt: null as Date | null }
  const userAcls: Row[] = []
  const roleAcls: Row[] = []
  const links: Row[] = []
  const rows = (entity: unknown): Row[] => {
    if (entity === User) return [user]
    if (entity === UserAcl) return userAcls
    if (entity === RoleAcl) return roleAcls
    if (entity === UserRole) return links
    return []
  }
  const findOne = jest.fn(async (entity: unknown, where: Row) =>
    rows(entity).find((row) => matches(row, where)) ?? null)
  const find = jest.fn(async (entity: unknown, where: Row) =>
    rows(entity).filter((row) => matches(row, where)))
  const fork = jest.fn()
  const em = { findOne, find, fork }
  fork.mockReturnValue(em)
  const service = new RbacService(em as unknown as EntityManager, createMemoryStrategy())
  return { user, role, userAcls, roleAcls, links, em, service }
}

describe('live ACL authorization in replay and organization projections', () => {
  it.each(['revoked', 'foreign-tenant'])('ignores a %s direct super-admin grant', async (kind) => {
    const fixture = createFixture()
    fixture.userAcls.push({
      user: fixture.user.id,
      tenantId: kind === 'foreign-tenant' ? 'tenant-foreign' : fixture.user.tenantId,
      deletedAt: kind === 'revoked' ? new Date() : null,
      isSuperAdmin: true,
    })
    const acl = await fixture.service.loadAclWithEntityManager(
      fixture.em as unknown as EntityManager,
      fixture.user.id,
      { tenantId: fixture.user.tenantId, organizationId: null },
    )
    expect(acl.isSuperAdmin).toBe(false)
    expect(acl.features).toEqual([])
    const access = await fixture.service.resolveFeatureOrganizationAccess(
      fixture.user.id, ['auth.users.list'], { tenantId: fixture.user.tenantId },
    )
    expect(access.unrestricted).toBe(false)
    expect(access.filterOrganizationIds([{ id: 'org-one' }])).toEqual([])
  })

  it.each(['revoked-acl', 'foreign-tenant', 'revoked-link', 'revoked-role'])(
    'ignores a %s role super-admin grant',
    async (kind) => {
      const fixture = createFixture()
      fixture.role.deletedAt = kind === 'revoked-role' ? new Date() : null
      fixture.links.push({
        user: fixture.user.id,
        role: fixture.role,
        deletedAt: kind === 'revoked-link' ? new Date() : null,
      })
      fixture.roleAcls.push({
        role: fixture.role,
        tenantId: kind === 'foreign-tenant' ? 'tenant-foreign' : fixture.user.tenantId,
        deletedAt: kind === 'revoked-acl' ? new Date() : null,
        isSuperAdmin: true,
        organizationsJson: null,
        featuresJson: ['*'],
      })
      const acl = await fixture.service.loadAclWithEntityManager(
        fixture.em as unknown as EntityManager,
        fixture.user.id,
        { tenantId: fixture.user.tenantId, organizationId: null },
      )
      expect(acl.isSuperAdmin).toBe(false)
      expect(acl.features).toEqual([])
      const access = await fixture.service.resolveFeatureOrganizationAccess(
        fixture.user.id, ['auth.users.list'], { tenantId: fixture.user.tenantId },
      )
      expect(access.unrestricted).toBe(false)
      expect(access.filterOrganizationIds([{ id: 'org-one' }])).toEqual([])
    },
  )

  it('bypasses cached super-admin authority when reading a transaction snapshot', async () => {
    const fixture = createFixture()
    const grant = {
      user: fixture.user.id, tenantId: fixture.user.tenantId, deletedAt: null as Date | null,
      isSuperAdmin: true, featuresJson: ['*'], organizationsJson: null,
    }
    fixture.userAcls.push(grant)
    await expect(fixture.service.loadAcl(
      fixture.user.id, { tenantId: fixture.user.tenantId, organizationId: null },
    )).resolves.toMatchObject({ isSuperAdmin: true })
    grant.deletedAt = new Date()
    fixture.em.fork.mockClear()
    await expect(fixture.service.loadAclWithEntityManager(
      fixture.em as unknown as EntityManager,
      fixture.user.id,
      { tenantId: fixture.user.tenantId, organizationId: null },
    )).resolves.toMatchObject({ isSuperAdmin: false, features: [] })
    expect(fixture.em.fork).not.toHaveBeenCalled()
  })

  it('preserves a live own-tenant super-admin across tenant projections', async () => {
    const fixture = createFixture()
    fixture.userAcls.push({
      user: fixture.user.id, tenantId: fixture.user.tenantId, deletedAt: null, isSuperAdmin: true,
    })
    await expect(fixture.service.loadAclWithEntityManager(
      fixture.em as unknown as EntityManager,
      fixture.user.id,
      { tenantId: 'tenant-other', organizationId: null },
    )).resolves.toMatchObject({ isSuperAdmin: true, features: ['*'] })
    const access = await fixture.service.resolveFeatureOrganizationAccess(
      fixture.user.id, ['auth.users.list'], { tenantId: 'tenant-other' },
    )
    expect(access.unrestricted).toBe(true)
  })
})
