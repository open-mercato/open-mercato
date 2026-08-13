/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  StaffIdentityProjectionScope,
} from '@open-mercato/core/modules/staff/contracts/identityProjectionResolver'
import { StaffTeamMember } from '../../data/entities'
import { createStaffIdentityProjectionResolver } from '../identityProjectionResolver'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<
  typeof findWithDecryption
>

const scope: StaffIdentityProjectionScope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const firstStaffMemberId = '33333333-3333-4333-8333-333333333333'
const secondStaffMemberId = '44444444-4444-4444-8444-444444444444'

function member(overrides: Partial<StaffTeamMember> = {}): StaffTeamMember {
  return {
    id: firstStaffMemberId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    displayName: 'Ada Lovelace',
    userId: '55555555-5555-4555-8555-555555555555',
    isActive: true,
    ...overrides,
  } as StaffTeamMember
}

function makeStaffMemberId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

describe('createStaffIdentityProjectionResolver', () => {
  const em = {} as EntityManager
  const resolver = createStaffIdentityProjectionResolver(em)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns an empty projection without querying for a valid empty input', async () => {
    await expect(resolver.resolveByIds(scope, [])).resolves.toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('returns active and inactive non-deleted matches with exact scope and minimal fields', async () => {
    mockFindWithDecryption.mockResolvedValue([
      member({ id: secondStaffMemberId, displayName: 'Grace Hopper', isActive: false }),
      member(),
    ])

    const result = await resolver.resolveByIds(scope, [firstStaffMemberId, secondStaffMemberId])

    expect(result).toEqual([
      {
        staffMemberId: secondStaffMemberId,
        displayName: 'Grace Hopper',
        isActive: false,
      },
      {
        staffMemberId: firstStaffMemberId,
        displayName: 'Ada Lovelace',
        isActive: true,
      },
    ])
    expect(result.every((projection) => !('userId' in projection))).toBe(true)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      StaffTeamMember,
      {
        id: { $in: [firstStaffMemberId, secondStaffMemberId] },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    const where = mockFindWithDecryption.mock.calls[0]?.[2]
    expect(where).not.toHaveProperty('isActive')
  })

  it('deduplicates input IDs before querying and duplicate rows before returning', async () => {
    mockFindWithDecryption.mockResolvedValue([
      member(),
      member({ displayName: 'Latest decrypted value' }),
    ])

    await expect(
      resolver.resolveByIds(scope, [firstStaffMemberId, firstStaffMemberId]),
    ).resolves.toEqual([
      {
        staffMemberId: firstStaffMemberId,
        displayName: 'Latest decrypted value',
        isActive: true,
      },
    ])
    expect(mockFindWithDecryption.mock.calls[0]?.[2]).toMatchObject({
      id: { $in: [firstStaffMemberId] },
    })
  })

  it('accepts exactly 100 raw IDs', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => makeStaffMemberId(index + 1))
    mockFindWithDecryption.mockResolvedValue([])

    await expect(resolver.resolveByIds(scope, ids)).resolves.toEqual([])
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('rejects more than 100 raw IDs before deduplication or query', async () => {
    const repeatedIds = Array.from({ length: 101 }, () => firstStaffMemberId)

    await expect(resolver.resolveByIds(scope, repeatedIds)).rejects.toBeInstanceOf(TypeError)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it.each([
    ['tenant ID', { ...scope, tenantId: 'invalid' }, [firstStaffMemberId]],
    ['organization ID', { ...scope, organizationId: '' }, [firstStaffMemberId]],
    ['Staff member ID', scope, ['not-a-uuid']],
  ] as const)('rejects an invalid %s before querying', async (_label, invalidScope, ids) => {
    await expect(resolver.resolveByIds(invalidScope, [...ids])).rejects.toBeInstanceOf(TypeError)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('rejects a non-array runtime input before querying', async () => {
    await expect(
      resolver.resolveByIds(scope, null as unknown as string[]),
    ).rejects.toBeInstanceOf(TypeError)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it.each(['missing', 'deleted', 'cross-scope'])(
    'omits a %s Staff row filtered out by the exact scoped query',
    async () => {
      mockFindWithDecryption.mockResolvedValue([])

      await expect(resolver.resolveByIds(scope, [firstStaffMemberId])).resolves.toEqual([])
    },
  )

  it('propagates database or decryption failures without a partial result', async () => {
    const failure = new Error('read failed')
    mockFindWithDecryption.mockRejectedValueOnce(failure)

    await expect(resolver.resolveByIds(scope, [firstStaffMemberId])).rejects.toBe(failure)
  })
})
