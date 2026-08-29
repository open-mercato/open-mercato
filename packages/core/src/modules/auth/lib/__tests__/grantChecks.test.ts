/** @jest-environment node */

import {
  assertActorCanModifySuperAdminUserTarget,
  assertActorCanModifySuperAdminRoleTarget,
  isUserEffectivelySuperAdmin,
  isRoleEffectivelySuperAdmin,
  listSuperAdminUserIds,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

const tenantId = '11111111-1111-1111-1111-111111111111'
const otherTenantId = '99999999-9999-9999-9999-999999999999'
const actorId = '22222222-2222-2222-2222-222222222222'
const targetUserId = '33333333-3333-3333-3333-333333333333'
const targetRoleId = '44444444-4444-4444-4444-444444444444'
const superAdminRoleId = '55555555-5555-5555-5555-555555555555'
const otherUserId = '66666666-6666-6666-6666-666666666666'

// ---------------------------------------------------------------------------
// A small in-memory table set, and an EntityManager double that EVALUATES the
// filter the code really emits against it.
//
// This is deliberate rather than incidental: the previous doubles answered from
// `mockResolvedValueOnce` queues keyed on call order, so a query that named no
// tenant and a query that named the right one produced identical results and
// the suite stayed green either way. The lookups under test differ from each
// other only in their filters, so a double that ignores filters cannot see the
// defect at all.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

type Db = {
  users: Row[]
  roles: Row[]
  userAcls: Row[]
  roleAcls: Row[]
  userRoles: Row[]
}

function emptyDb(): Db {
  return { users: [], roles: [], userAcls: [], roleAcls: [], userRoles: [] }
}

function refId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string') return id
  }
  return null
}

function tableFor(db: Db, entity: unknown): Row[] {
  if (entity === User) return db.users
  if (entity === Role) return db.roles
  if (entity === UserAcl) return db.userAcls
  if (entity === RoleAcl) return db.roleAcls
  if (entity === UserRole) return db.userRoles
  throw new Error(`unmapped entity in test double: ${String((entity as { name?: string })?.name)}`)
}

// Which table a relation column points at, so a nested filter such as
// `{ role: { tenantId } }` can be resolved the way the ORM would.
function relatedTable(db: Db, column: string): Row[] {
  if (column === 'user') return db.users
  if (column === 'role') return db.roles
  throw new Error(`unmapped relation in test double: ${column}`)
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

function matchesRow(db: Db, row: Row, where: Row): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const actual = row[key]
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Row
      if (Array.isArray(cond.$in)) {
        const id = refId(actual)
        if (!id || !(cond.$in as unknown[]).includes(id)) return false
        continue
      }
      // Nested filter on a relation: resolve the referenced row and match there.
      const id = refId(actual)
      if (!id) return false
      const related = relatedTable(db, key).find((candidate) => candidate.id === id)
      if (!related) return false
      if (!matchesRow(db, related, cond)) return false
      continue
    }
    if (key === 'id' || key === 'user' || key === 'role') {
      if (refId(actual) !== condition) return false
      continue
    }
    if (!matchesValue(actual, condition)) return false
  }
  return true
}

function makeEm(db: Db) {
  const findMany = jest.fn((entity: unknown, where: Row) =>
    Promise.resolve(tableFor(db, entity).filter((row) => matchesRow(db, row, where ?? {}))))
  const em = {
    find: findMany,
    findOne: jest.fn((entity: unknown, where: Row) =>
      Promise.resolve(tableFor(db, entity).find((row) => matchesRow(db, row, where ?? {})) ?? null)),
  }
  // `findWithDecryption` is only ever used here to read `user_roles`; route it
  // into the same tables so its filter is evaluated too.
  mockFindWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Row) =>
    Promise.resolve(tableFor(db, entity).filter((row) => matchesRow(db, row, where ?? {}))))
  return em
}

function makeRbac(actorIsSuperAdmin: boolean) {
  return {
    loadAcl: jest.fn().mockResolvedValue({
      isSuperAdmin: actorIsSuperAdmin,
      features: [],
      organizations: null,
    }),
  }
}

/** A user in `tenantId` holding a live, own-tenant super-admin grant. */
function dbWithDirectGrant(): Db {
  const db = emptyDb()
  db.users.push({ id: targetUserId, tenantId, deletedAt: null })
  db.userAcls.push({ id: 'acl-1', user: targetUserId, tenantId, isSuperAdmin: true, deletedAt: null })
  return db
}

/** A user in `tenantId` whose super-admin comes from a role of that tenant. */
function dbWithRoleGrant(): Db {
  const db = emptyDb()
  db.users.push({ id: targetUserId, tenantId, deletedAt: null })
  db.roles.push({ id: superAdminRoleId, tenantId, deletedAt: null })
  db.userRoles.push({ id: 'link-1', user: targetUserId, role: superAdminRoleId, deletedAt: null })
  db.roleAcls.push({
    id: 'racl-1',
    role: superAdminRoleId,
    tenantId,
    isSuperAdmin: true,
    organizationsJson: null,
    deletedAt: null,
  })
  return db
}

beforeEach(() => {
  mockFindWithDecryption.mockReset()
  mockFindWithDecryption.mockResolvedValue([])
})

describe('isUserEffectivelySuperAdmin', () => {
  test('returns true when the user has a direct UserAcl super admin grant', async () => {
    const em = makeEm(dbWithDirectGrant())
    expect(await isUserEffectivelySuperAdmin(em as never, targetUserId)).toBe(true)
  })

  test('returns true when any assigned role grants super admin', async () => {
    const em = makeEm(dbWithRoleGrant())
    expect(await isUserEffectivelySuperAdmin(em as never, targetUserId)).toBe(true)
  })

  test('returns false when neither UserAcl nor any role grants super admin', async () => {
    const db = emptyDb()
    db.users.push({ id: targetUserId, tenantId, deletedAt: null })
    db.roles.push({ id: targetRoleId, tenantId, deletedAt: null })
    db.userRoles.push({ id: 'link-1', user: targetUserId, role: targetRoleId, deletedAt: null })
    db.roleAcls.push({ id: 'racl-1', role: targetRoleId, tenantId, isSuperAdmin: false, deletedAt: null })

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(false)
  })

  test('returns false when the user has no role assignments and no UserAcl grant', async () => {
    const db = emptyDb()
    db.users.push({ id: targetUserId, tenantId, deletedAt: null })

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(false)
  })

  // --- the tenant binding ---------------------------------------------------

  test('ignores a UserAcl grant stamped with a tenant other than the user own', async () => {
    const db = dbWithDirectGrant()
    db.userAcls[0]!.tenantId = otherTenantId

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(false)
  })

  test('ignores a RoleAcl grant stamped with a tenant other than the user own', async () => {
    const db = dbWithRoleGrant()
    db.roleAcls[0]!.tenantId = otherTenantId

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(false)
  })

  test('ignores a role that belongs to another tenant', async () => {
    const db = dbWithRoleGrant()
    db.roles[0]!.tenantId = otherTenantId
    db.roleAcls[0]!.tenantId = otherTenantId

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(false)
  })

  test('returns false for a user with no tenant of their own', async () => {
    const db = dbWithDirectGrant()
    db.users[0]!.tenantId = null

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(false)
  })

  test('returns false for a grant that outlives the user row it names', async () => {
    const db = dbWithDirectGrant()
    db.users = []

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(false)
  })

  // --- revoked grants -------------------------------------------------------

  test('ignores a soft-deleted UserAcl grant', async () => {
    const db = dbWithDirectGrant()
    db.userAcls[0]!.deletedAt = new Date('2026-08-01T00:00:00Z')

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(false)
  })

  test('ignores a soft-deleted RoleAcl grant', async () => {
    const db = dbWithRoleGrant()
    db.roleAcls[0]!.deletedAt = new Date('2026-08-01T00:00:00Z')

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(false)
  })

  // --- deliberate over-inclusion --------------------------------------------

  test('still protects a soft-deleted user holding a live grant', async () => {
    const db = dbWithDirectGrant()
    db.users[0]!.deletedAt = new Date('2026-08-01T00:00:00Z')

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(true)
  })

  test('still protects a holder of an organization-restricted super admin role', async () => {
    // `RbacService.isGlobalSuperAdmin` drops these from the GLOBAL answer, but
    // the scoped projection still reports isSuperAdmin inside those
    // organizations, so the target stays privileged and must stay protected.
    const db = dbWithRoleGrant()
    db.roleAcls[0]!.organizationsJson = ['77777777-7777-7777-7777-777777777777']

    expect(await isUserEffectivelySuperAdmin(makeEm(db) as never, targetUserId)).toBe(true)
  })
})

describe('isRoleEffectivelySuperAdmin', () => {
  function dbWithRoleAcl(): Db {
    const db = emptyDb()
    db.roles.push({ id: targetRoleId, tenantId, deletedAt: null })
    db.roleAcls.push({ id: 'racl-1', role: targetRoleId, tenantId, isSuperAdmin: true, deletedAt: null })
    return db
  }

  test('returns true when the role has a RoleAcl super admin grant', async () => {
    expect(await isRoleEffectivelySuperAdmin(makeEm(dbWithRoleAcl()) as never, targetRoleId)).toBe(true)
  })

  test('returns false when no RoleAcl grant flags the role as super admin', async () => {
    const db = dbWithRoleAcl()
    db.roleAcls[0]!.isSuperAdmin = false

    expect(await isRoleEffectivelySuperAdmin(makeEm(db) as never, targetRoleId)).toBe(false)
  })

  test('ignores a grant stamped with a tenant other than the role own', async () => {
    const db = dbWithRoleAcl()
    db.roleAcls[0]!.tenantId = otherTenantId

    expect(await isRoleEffectivelySuperAdmin(makeEm(db) as never, targetRoleId)).toBe(false)
  })

  test('ignores a soft-deleted grant', async () => {
    const db = dbWithRoleAcl()
    db.roleAcls[0]!.deletedAt = new Date('2026-08-01T00:00:00Z')

    expect(await isRoleEffectivelySuperAdmin(makeEm(db) as never, targetRoleId)).toBe(false)
  })

  test('returns false for a grant that outlives the role row it names', async () => {
    const db = dbWithRoleAcl()
    db.roles = []

    expect(await isRoleEffectivelySuperAdmin(makeEm(db) as never, targetRoleId)).toBe(false)
  })
})

describe('assertActorCanModifySuperAdminUserTarget', () => {
  test('always allows super admin actors', async () => {
    const em = makeEm(dbWithDirectGrant())
    const rbacService = makeRbac(true)

    await expect(
      assertActorCanModifySuperAdminUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).resolves.toBeUndefined()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  test('forbids non-super admin actors when the target is a super admin', async () => {
    await expect(
      assertActorCanModifySuperAdminUserTarget({
        em: makeEm(dbWithDirectGrant()) as never,
        rbacService: makeRbac(false) as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('allows non-super admin actors when the target is not a super admin', async () => {
    const db = emptyDb()
    db.users.push({ id: targetUserId, tenantId, deletedAt: null })

    await expect(
      assertActorCanModifySuperAdminUserTarget({
        em: makeEm(db) as never,
        rbacService: makeRbac(false) as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).resolves.toBeUndefined()
  })

  test('allows a non-super admin actor to manage a user whose super admin was revoked', async () => {
    // The trap this closes: an over-broad protection predicate never expires, so
    // revoking a super-admin would leave the account unmanageable by the very
    // tenant admins who revoked it.
    const db = dbWithDirectGrant()
    db.userAcls[0]!.deletedAt = new Date('2026-08-01T00:00:00Z')

    await expect(
      assertActorCanModifySuperAdminUserTarget({
        em: makeEm(db) as never,
        rbacService: makeRbac(false) as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('assertActorCanModifySuperAdminRoleTarget', () => {
  function dbWithSuperAdminRole(): Db {
    const db = emptyDb()
    db.roles.push({ id: targetRoleId, tenantId, deletedAt: null })
    db.roleAcls.push({ id: 'racl-1', role: targetRoleId, tenantId, isSuperAdmin: true, deletedAt: null })
    return db
  }

  test('always allows super admin actors', async () => {
    const em = makeEm(dbWithSuperAdminRole())
    const rbacService = makeRbac(true)

    await expect(
      assertActorCanModifySuperAdminRoleTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).resolves.toBeUndefined()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  test('forbids non-super admin actors when the target role is a super admin role', async () => {
    await expect(
      assertActorCanModifySuperAdminRoleTarget({
        em: makeEm(dbWithSuperAdminRole()) as never,
        rbacService: makeRbac(false) as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('allows non-super admin actors when the role is not a super admin role', async () => {
    const db = dbWithSuperAdminRole()
    db.roleAcls[0]!.isSuperAdmin = false

    await expect(
      assertActorCanModifySuperAdminRoleTarget({
        em: makeEm(db) as never,
        rbacService: makeRbac(false) as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('listSuperAdminUserIds', () => {
  function dbWithBothHalves(): Db {
    const db = emptyDb()
    db.users.push({ id: targetUserId, tenantId, deletedAt: null })
    db.users.push({ id: otherUserId, tenantId, deletedAt: null })
    db.userAcls.push({ id: 'acl-1', user: targetUserId, tenantId, isSuperAdmin: true, deletedAt: null })
    db.roles.push({ id: superAdminRoleId, tenantId, deletedAt: null })
    db.roleAcls.push({
      id: 'racl-1',
      role: superAdminRoleId,
      tenantId,
      isSuperAdmin: true,
      organizationsJson: null,
      deletedAt: null,
    })
    db.userRoles.push({ id: 'link-1', user: otherUserId, role: superAdminRoleId, deletedAt: null })
    return db
  }

  test('returns the union of UserAcl and role-derived super admin user ids', async () => {
    const result = await listSuperAdminUserIds(makeEm(dbWithBothHalves()) as never, tenantId)

    expect(result).toEqual(new Set([targetUserId, otherUserId]))
  })

  test('returns an empty set when there are no super admin grants', async () => {
    const db = emptyDb()
    db.users.push({ id: targetUserId, tenantId, deletedAt: null })

    const result = await listSuperAdminUserIds(makeEm(db) as never, tenantId)

    expect(result.size).toBe(0)
  })

  test('applies the tenant filter to the RoleAcl half as well as the UserAcl half', async () => {
    // The half that used to be unfiltered. A role ACL stamped elsewhere confers
    // no super-admin (see `RbacService.isGlobalSuperAdmin`), so its members are
    // ordinary users of this tenant and must not be hidden from it.
    const db = dbWithBothHalves()
    db.roleAcls[0]!.tenantId = otherTenantId

    const result = await listSuperAdminUserIds(makeEm(db) as never, tenantId)

    expect(result).toEqual(new Set([targetUserId]))
  })

  test('ignores soft-deleted grants on both halves', async () => {
    const db = dbWithBothHalves()
    db.userAcls[0]!.deletedAt = new Date('2026-08-01T00:00:00Z')
    db.roleAcls[0]!.deletedAt = new Date('2026-08-01T00:00:00Z')

    const result = await listSuperAdminUserIds(makeEm(db) as never, tenantId)

    expect(result.size).toBe(0)
  })

  test('keeps organization-restricted super admin roles in the exclusion list', async () => {
    const db = dbWithBothHalves()
    db.roleAcls[0]!.organizationsJson = ['77777777-7777-7777-7777-777777777777']

    const result = await listSuperAdminUserIds(makeEm(db) as never, tenantId)

    expect(result).toEqual(new Set([targetUserId, otherUserId]))
  })

  test('applies no tenant filter to either half when no tenant is given', async () => {
    const db = dbWithBothHalves()
    db.userAcls[0]!.tenantId = otherTenantId
    db.roleAcls[0]!.tenantId = otherTenantId

    const result = await listSuperAdminUserIds(makeEm(db) as never, null)

    expect(result).toEqual(new Set([targetUserId, otherUserId]))
  })
})
