/** @jest-environment node */

import {
  assertActorCanAccessUserTarget,
  assertActorCanAccessRoleTarget,
} from '@open-mercato/core/modules/auth/lib/grantChecks'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn(),
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

function makeRbac(acl: { isSuperAdmin: boolean; features?: string[]; organizations?: string[] | null }) {
  return {
    loadAcl: jest.fn().mockResolvedValue({
      isSuperAdmin: acl.isSuperAdmin,
      features: acl.features ?? [],
      organizations: acl.organizations ?? null,
    }),
  }
}

const tenantId = '11111111-1111-1111-1111-111111111111'
const otherTenantId = '99999999-9999-9999-9999-999999999999'
const actorId = '22222222-2222-2222-2222-222222222222'
const targetUserId = '33333333-3333-3333-3333-333333333333'
const targetRoleId = '44444444-4444-4444-4444-444444444444'
const orgId = '55555555-5555-5555-5555-555555555555'

beforeEach(() => {
  mockFindOneWithDecryption.mockReset()
})

describe('assertActorCanAccessUserTarget', () => {
  test('allows a super admin actor without loading the target', async () => {
    const em = makeEm()
    const rbacService = makeRbac({ isSuperAdmin: true })

    await expect(
      assertActorCanAccessUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).resolves.toBeUndefined()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  test('allows a same-tenant target for a non-superadmin actor', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: orgId })
    const rbacService = makeRbac({ isSuperAdmin: false, organizations: null })

    await expect(
      assertActorCanAccessUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).resolves.toBeUndefined()
  })

  test('delegates (does not throw) when the target user does not exist or is soft-deleted', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const rbacService = makeRbac({ isSuperAdmin: false })

    await expect(
      assertActorCanAccessUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).resolves.toBeUndefined()
  })

  test('hides a cross-tenant target as 404', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: targetUserId, tenantId: otherTenantId, organizationId: orgId })
    const rbacService = makeRbac({ isSuperAdmin: false })

    await expect(
      assertActorCanAccessUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('hides a null-tenant target from a non-superadmin as 404', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: targetUserId, tenantId: null, organizationId: null })
    const rbacService = makeRbac({ isSuperAdmin: false })

    await expect(
      assertActorCanAccessUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetUserId,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('returns 403 for an org-restricted actor with an out-of-scope in-tenant target', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: 'other-org' })
    const rbacService = makeRbac({ isSuperAdmin: false, organizations: [orgId] })

    await expect(
      assertActorCanAccessUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        organizationId: orgId,
        targetUserId,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('allows an org-restricted actor when the target is in scope', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: orgId })
    const rbacService = makeRbac({ isSuperAdmin: false, organizations: [orgId] })

    await expect(
      assertActorCanAccessUserTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        organizationId: orgId,
        targetUserId,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('assertActorCanAccessRoleTarget', () => {
  test('allows a super admin actor without loading the target', async () => {
    const em = makeEm()
    const rbacService = makeRbac({ isSuperAdmin: true })

    await expect(
      assertActorCanAccessRoleTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).resolves.toBeUndefined()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  test('allows a same-tenant role for a non-superadmin actor', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: targetRoleId, tenantId })
    const rbacService = makeRbac({ isSuperAdmin: false })

    await expect(
      assertActorCanAccessRoleTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).resolves.toBeUndefined()
  })

  test('delegates (does not throw) when the role does not exist or is soft-deleted', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const rbacService = makeRbac({ isSuperAdmin: false })

    await expect(
      assertActorCanAccessRoleTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).resolves.toBeUndefined()
  })

  test('hides a cross-tenant role as 404', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: targetRoleId, tenantId: otherTenantId })
    const rbacService = makeRbac({ isSuperAdmin: false })

    await expect(
      assertActorCanAccessRoleTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('hides a null-tenant role from a non-superadmin as 404', async () => {
    const em = makeEm()
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: targetRoleId, tenantId: null })
    const rbacService = makeRbac({ isSuperAdmin: false })

    await expect(
      assertActorCanAccessRoleTarget({
        em: em as never,
        rbacService: rbacService as never,
        actorUserId: actorId,
        tenantId,
        targetRoleId,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
