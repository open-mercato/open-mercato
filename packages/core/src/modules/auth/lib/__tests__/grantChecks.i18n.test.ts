/** @jest-environment node */

import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { Dict } from '@open-mercato/shared/lib/i18n/context'
import {
  assertActorCanAccessUserTarget,
  assertActorCanGrantAcl,
  assertActorCanGrantRoleTokens,
  assertActorCanModifySuperAdminUserTarget,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import enDict from '../../i18n/en.json'
import plDict from '../../i18n/pl.json'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
let mockDict: Dict = plDict

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: createFallbackTranslator(mockDict) }),
}))

const tenantId = '11111111-1111-1111-1111-111111111111'
const actorId = '22222222-2222-2222-2222-222222222222'
const targetUserId = '33333333-3333-3333-3333-333333333333'
const parentOrgId = '44444444-4444-4444-4444-444444444444'
const siblingOrgId = '55555555-5555-5555-5555-555555555555'

function makeRbac(acl: { isSuperAdmin?: boolean; features?: string[]; organizations?: string[] | null }) {
  return {
    loadAcl: jest.fn().mockResolvedValue({
      isSuperAdmin: acl.isSuperAdmin ?? false,
      features: acl.features ?? [],
      organizations: acl.organizations ?? null,
    }),
  }
}

function makeEm() {
  return { findOne: jest.fn(), find: jest.fn() }
}

function restrictedAdminContext(acl: { features?: string[]; organizations?: string[] | null } = {}) {
  return {
    em: makeEm() as never,
    rbacService: makeRbac({ features: ['auth.users.*'], organizations: [parentOrgId], ...acl }) as never,
    actorUserId: actorId,
    tenantId,
  }
}

beforeEach(() => {
  mockDict = plDict
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindWithDecryption.mockResolvedValue([])
})

describe('grant check errors are translated', () => {
  test('refusing access to a user outside the actor organizations', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: siblingOrgId })

    await expect(
      assertActorCanAccessUserTarget({
        ...restrictedAdminContext(),
        targetUserId,
        organizationScope: { allowedIds: [parentOrgId] },
      }),
    ).rejects.toMatchObject({
      status: 403,
      body: { error: plDict['auth.users.errors.targetAccessDenied'] },
    })
  })

  test('refusing to modify a super administrator account', async () => {
    const context = restrictedAdminContext()
    ;(context.em as unknown as { findOne: jest.Mock }).findOne.mockResolvedValueOnce({ isSuperAdmin: true })

    await expect(
      assertActorCanModifySuperAdminUserTarget({ ...context, targetUserId }),
    ).rejects.toMatchObject({
      status: 403,
      body: { error: plDict['auth.users.errors.superAdminTargetProtected'] },
    })
  })

  test('refusing a feature the actor cannot grant, with the feature id interpolated', async () => {
    await expect(
      assertActorCanGrantAcl({ ...restrictedAdminContext(), features: ['sales.orders.delete'] }),
    ).rejects.toMatchObject({
      status: 403,
      body: { error: 'Nie można nadać uprawnienia sales.orders.delete.' },
    })
  })

  test('refusing unrestricted organization access', async () => {
    await expect(
      assertActorCanGrantAcl({ ...restrictedAdminContext(), features: [], organizations: null }),
    ).rejects.toMatchObject({
      status: 403,
      body: { error: plDict['auth.acl.errors.unrestrictedOrganizationsGrantDenied'] },
    })
  })

  test('refusing unknown roles, with the role list interpolated', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    await expect(
      assertActorCanGrantRoleTokens({ ...restrictedAdminContext(), roleTokens: ['ghost'] }),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'Nie znaleziono ról: "ghost"' },
    })
  })

  test('keeps the English messages unchanged', async () => {
    mockDict = enDict

    await expect(
      assertActorCanGrantAcl({ ...restrictedAdminContext(), features: ['sales.orders.delete'] }),
    ).rejects.toMatchObject({ body: { error: 'Cannot grant feature sales.orders.delete.' } })
    await expect(
      assertActorCanGrantAcl({ ...restrictedAdminContext(), features: [], organizations: null }),
    ).rejects.toMatchObject({ body: { error: 'Cannot grant unrestricted organization access.' } })
  })
})
