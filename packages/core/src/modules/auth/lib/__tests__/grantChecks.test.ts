/** @jest-environment node */

import {
  assertActorCanModifySuperAdminUserTarget,
  assertActorCanModifySuperAdminRoleTarget,
  isUserEffectivelySuperAdmin,
  isRoleEffectivelySuperAdmin,
  listSuperAdminUserIds,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import { RoleAcl, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

type MockEm = {
  findOne: jest.Mock
  find: jest.Mock
}

function makeEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
  }
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

const tenantId = '11111111-1111-1111-1111-111111111111'
const actorId = '22222222-2222-2222-2222-222222222222'
const targetUserId = '33333333-3333-3333-3333-333333333333'
const targetRoleId = '44444444-4444-4444-4444-444444444444'
const superAdminRoleId = '55555555-5555-5555-5555-555555555555'

beforeEach(() => {
  mockFindWithDecryption.mockReset()
  mockFindWithDecryption.mockResolvedValue([])
})

describe('isUserEffectivelySuperAdmin', () => {
  test('returns true when the user has a direct UserAcl super admin grant', async () => {
    const em = makeEm()
    em.findOne.mockResolvedValueOnce({ isSuperAdmin: true })

    const result = await isUserEffectivelySuperAdmin(em as never, targetUserId)

    expect(result).toBe(true)
    expect(em.findOne).toHaveBeenCalledWith(UserAcl, expect.objectContaining({ isSuperAdmin: true }))
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  test('returns true when any assigned role grants super admin', async () => {
    const em = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    mockFindWithDecryption.mockResolvedValueOnce([{ role: { id: superAdminRoleId } }])
    em.findOne.mockResolvedValueOnce({ isSuperAdmin: true })

    const result = await isUserEffectivelySuperAdmin(em as never, targetUserId)

    expect(result).toBe(true)
    expect(em.findOne).toHaveBeenLastCalledWith(
      RoleAcl,
      expect.objectContaining({ isSuperAdmin: true }),
    )
  })

  test('returns false when neither UserAcl nor any role grants super admin', async () => {
    const em = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    mockFindWithDecryption.mockResolvedValueOnce([{ role: { id: targetRoleId } }])
    em.findOne.mockResolvedValueOnce(null)

    const result = await isUserEffectivelySuperAdmin(em as never, targetUserId)

    expect(result).toBe(false)
  })

  test('returns false when the user has no role assignments and no UserAcl grant', async () => {
    const em = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    mockFindWithDecryption.mockResolvedValueOnce([])

    const result = await isUserEffectivelySuperAdmin(em as never, targetUserId)

    expect(result).toBe(false)
  })
})

describe('isRoleEffectivelySuperAdmin', () => {
  test('returns true when the role has a RoleAcl super admin grant', async () => {
    const em = makeEm()
    em.findOne.mockResolvedValueOnce({ isSuperAdmin: true })

    const result = await isRoleEffectivelySuperAdmin(em as never, targetRoleId)

    expect(result).toBe(true)
  })

  test('returns false when no RoleAcl grant flags the role as super admin', async () => {
    const em = makeEm()
    em.findOne.mockResolvedValueOnce(null)

    const result = await isRoleEffectivelySuperAdmin(em as never, targetRoleId)

    expect(result).toBe(false)
  })
})

describe('assertActorCanModifySuperAdminUserTarget', () => {
  test('always allows super admin actors', async () => {
    const em = makeEm()
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
    const em = makeEm()
    em.findOne.mockResolvedValueOnce({ isSuperAdmin: true })
    const rbacService = makeRbac(false)

    await expect(
      assertActorCanModifySuperAdminUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('allows non-super admin actors when the target is not a super admin', async () => {
    const em = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    mockFindWithDecryption.mockResolvedValueOnce([])
    const rbacService = makeRbac(false)

    await expect(
      assertActorCanModifySuperAdminUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('assertActorCanModifySuperAdminRoleTarget', () => {
  test('always allows super admin actors', async () => {
    const em = makeEm()
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
    const em = makeEm()
    em.findOne.mockResolvedValueOnce({ isSuperAdmin: true })
    const rbacService = makeRbac(false)

    await expect(
      assertActorCanModifySuperAdminRoleTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('allows non-super admin actors when the role is not a super admin role', async () => {
    const em = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    const rbacService = makeRbac(false)

    await expect(
      assertActorCanModifySuperAdminRoleTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('listSuperAdminUserIds', () => {
  test('returns the union of UserAcl and role-derived super admin user ids', async () => {
    const em = makeEm()
    em.find
      .mockResolvedValueOnce([{ user: { id: targetUserId } }])
      .mockResolvedValueOnce([{ role: { id: superAdminRoleId } }])
    mockFindWithDecryption.mockResolvedValueOnce([{ user: { id: 'role-derived-user' } }])

    const result = await listSuperAdminUserIds(em as never, tenantId)

    expect(result).toEqual(new Set([targetUserId, 'role-derived-user']))
    expect(em.find).toHaveBeenNthCalledWith(1, UserAcl, expect.objectContaining({ tenantId, isSuperAdmin: true }))
    expect(em.find).toHaveBeenNthCalledWith(2, RoleAcl, expect.objectContaining({ isSuperAdmin: true }))
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      UserRole,
      expect.objectContaining({ role: expect.objectContaining({ $in: [superAdminRoleId] }) }),
      {},
      expect.objectContaining({ tenantId: null }),
    )
  })

  test('returns an empty set when there are no super admin grants', async () => {
    const em = makeEm()
    em.find.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const result = await listSuperAdminUserIds(em as never, tenantId)

    expect(result.size).toBe(0)
  })
})
