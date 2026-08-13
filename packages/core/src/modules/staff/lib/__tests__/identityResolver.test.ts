/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import type { StaffIdentityScope } from '@open-mercato/core/modules/staff/contracts/identityResolver'
import { StaffTeamMember } from '../../data/entities'
import { createStaffIdentityResolver } from '../identityResolver'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<
  typeof findOneWithDecryption
>
const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<
  typeof findWithDecryption
>

const scope: StaffIdentityScope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const userId = '33333333-3333-4333-8333-333333333333'
const staffMemberId = '44444444-4444-4444-8444-444444444444'

function member(overrides: Partial<StaffTeamMember> = {}): StaffTeamMember {
  return {
    id: staffMemberId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    displayName: 'Ada Lovelace',
    userId,
    isActive: true,
    ...overrides,
  } as StaffTeamMember
}

describe('createStaffIdentityResolver', () => {
  const em = {} as EntityManager
  const resolver = createStaffIdentityResolver(em)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('resolves one active Auth link with the exact scoped query and minimal projection', async () => {
    mockFindWithDecryption.mockResolvedValue([member()])

    await expect(resolver.resolveByUserId(scope, userId)).resolves.toEqual({
      kind: 'found',
      identity: {
        staffMemberId,
        userId,
        displayName: 'Ada Lovelace',
        isActive: true,
      },
    })
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      StaffTeamMember,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId,
        isActive: true,
        deletedAt: null,
      },
      { limit: 2 },
      scope,
    )
  })

  it('returns not_found when no active Auth link exists', async () => {
    mockFindWithDecryption.mockResolvedValue([])

    await expect(resolver.resolveByUserId(scope, userId)).resolves.toEqual({
      kind: 'not_found',
    })
  })

  it.each(['inactive', 'deleted', 'cross-scope'])(
    'does not disclose an %s Auth-linked Staff row filtered out by the scoped query',
    async () => {
      mockFindWithDecryption.mockResolvedValue([])

      await expect(resolver.resolveByUserId(scope, userId)).resolves.toEqual({
        kind: 'not_found',
      })
    },
  )

  it('returns ambiguous without exposing duplicate rows', async () => {
    mockFindWithDecryption.mockResolvedValue([
      member(),
      member({ id: '55555555-5555-4555-8555-555555555555' }),
    ])

    await expect(resolver.resolveByUserId(scope, userId)).resolves.toEqual({
      kind: 'ambiguous',
    })
  })

  it('resolves an active Staff member by exact scoped ID and normalizes an absent Auth link', async () => {
    mockFindOneWithDecryption.mockResolvedValue(member({ userId: null }))

    await expect(resolver.resolveByStaffMemberId(scope, staffMemberId)).resolves.toEqual({
      kind: 'found',
      identity: {
        staffMemberId,
        userId: null,
        displayName: 'Ada Lovelace',
        isActive: true,
      },
    })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      StaffTeamMember,
      {
        id: staffMemberId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        isActive: true,
        deletedAt: null,
      },
      undefined,
      scope,
    )
  })

  it('returns not_found when the exact Staff member lookup has no active row', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    await expect(resolver.resolveByStaffMemberId(scope, staffMemberId)).resolves.toEqual({
      kind: 'not_found',
    })
  })

  it.each([
    ['tenant ID', { ...scope, tenantId: 'invalid' }, userId, 'user'],
    ['organization ID', { ...scope, organizationId: '' }, userId, 'user'],
    ['Auth user ID', scope, 'not-a-uuid', 'user'],
    ['Staff member ID', scope, 'not-a-uuid', 'staff'],
  ] as const)('rejects an invalid %s before querying', async (_label, invalidScope, id, direction) => {
    const lookup = direction === 'user'
      ? resolver.resolveByUserId(invalidScope, id)
      : resolver.resolveByStaffMemberId(invalidScope, id)

    await expect(lookup).rejects.toBeInstanceOf(TypeError)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('propagates Auth lookup database or decryption failures', async () => {
    const failure = new Error('read failed')
    mockFindWithDecryption.mockRejectedValueOnce(failure)

    await expect(resolver.resolveByUserId(scope, userId)).rejects.toBe(failure)
  })

  it('propagates Staff lookup database or decryption failures', async () => {
    const failure = new Error('read failed')
    mockFindOneWithDecryption.mockRejectedValueOnce(failure)

    await expect(resolver.resolveByStaffMemberId(scope, staffMemberId)).rejects.toBe(failure)
  })
})
