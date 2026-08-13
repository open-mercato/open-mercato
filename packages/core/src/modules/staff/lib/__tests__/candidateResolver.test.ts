/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  StaffCandidateScope,
} from '@open-mercato/core/modules/staff/contracts/candidateResolver'
import { StaffTeamMember } from '../../data/entities'
import { createStaffCandidateResolver } from '../candidateResolver'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<
  typeof findWithDecryption
>

const scope: StaffCandidateScope = {
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
    deletedAt: null,
    ...overrides,
  } as StaffTeamMember
}

describe('createStaffCandidateResolver', () => {
  const mockCount = jest.fn()
  const em = { count: mockCount } as unknown as EntityManager
  const resolver = createStaffCandidateResolver(em)

  beforeEach(() => {
    jest.clearAllMocks()
    mockCount.mockResolvedValue(2)
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('returns a linked-only searched page with exact scope and minimal fields', async () => {
    const search = 'Ada%_\\'
    mockCount.mockResolvedValue(3)
    mockFindWithDecryption.mockResolvedValue([
      member({ id: secondStaffMemberId, displayName: 'Ada Byron' }),
      member(),
    ])

    const result = await resolver.listCandidates({
      ...scope,
      linkage: 'required',
      search: `  ${search}  `,
      page: 2,
      pageSize: 2,
    })

    const where = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      isActive: true,
      userId: { $ne: null },
      displayName: { $ilike: `%${escapeLikePattern(search)}%` },
    }
    expect(mockCount).toHaveBeenCalledWith(StaffTeamMember, where)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      StaffTeamMember,
      where,
      {
        limit: 2,
        offset: 2,
        orderBy: { displayName: 'asc', id: 'asc' },
      },
      scope,
    )
    expect(result).toEqual({
      items: [
        { staffMemberId: secondStaffMemberId, displayName: 'Ada Byron' },
        { staffMemberId: firstStaffMemberId, displayName: 'Ada Lovelace' },
      ],
      total: 3,
      page: 2,
      pageSize: 2,
      totalPages: 2,
    })
    expect(result.items.every((item) => !('userId' in item))).toBe(true)
  })

  it('includes linked and unlinked active Staff for any linkage without an empty search filter', async () => {
    mockFindWithDecryption.mockResolvedValue([
      member({ userId: null }),
    ])

    await expect(resolver.listCandidates({
      ...scope,
      linkage: 'any',
      search: '   ',
      page: 1,
      pageSize: 100,
    })).resolves.toMatchObject({
      items: [{ staffMemberId: firstStaffMemberId, displayName: 'Ada Lovelace' }],
      pageSize: 100,
    })

    const where = mockCount.mock.calls[0]?.[1]
    expect(where).toEqual({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      isActive: true,
    })
    expect(where).not.toHaveProperty('userId')
    expect(where).not.toHaveProperty('displayName')
    expect(mockFindWithDecryption.mock.calls[0]?.[2]).toEqual(where)
  })

  it.each([
    ['no matches', 0, 1, 0],
    ['a page beyond the end', 2, 3, 2],
  ] as const)(
    'returns empty items without a data query for %s',
    async (_label, total, page, totalPages) => {
      mockCount.mockResolvedValue(total)

      await expect(resolver.listCandidates({
        ...scope,
        linkage: 'any',
        page,
        pageSize: 1,
      })).resolves.toEqual({
        items: [],
        total,
        page,
        pageSize: 1,
        totalPages,
      })
      expect(mockFindWithDecryption).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['null input', null],
    ['tenant UUID', { ...scope, tenantId: 'invalid', linkage: 'any', page: 1, pageSize: 25 }],
    ['organization UUID', { ...scope, organizationId: '', linkage: 'any', page: 1, pageSize: 25 }],
    ['linkage', { ...scope, linkage: 'linked', page: 1, pageSize: 25 }],
    ['search length', { ...scope, linkage: 'any', search: 'x'.repeat(201), page: 1, pageSize: 25 }],
    ['page zero', { ...scope, linkage: 'any', page: 0, pageSize: 25 }],
    ['fractional page', { ...scope, linkage: 'any', page: 1.5, pageSize: 25 }],
    ['page size zero', { ...scope, linkage: 'any', page: 1, pageSize: 0 }],
    ['page size above 100', { ...scope, linkage: 'any', page: 1, pageSize: 101 }],
  ])('rejects an invalid %s before either query', async (_label, input) => {
    await expect(
      resolver.listCandidates(input as Parameters<typeof resolver.listCandidates>[0]),
    ).rejects.toBeInstanceOf(TypeError)
    expect(mockCount).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('propagates count failures before loading a page', async () => {
    const failure = new Error('count failed')
    mockCount.mockRejectedValueOnce(failure)

    await expect(resolver.listCandidates({
      ...scope,
      linkage: 'any',
      page: 1,
      pageSize: 25,
    })).rejects.toBe(failure)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('propagates database or decryption failures without a partial page', async () => {
    const failure = new Error('read failed')
    mockFindWithDecryption.mockRejectedValueOnce(failure)

    await expect(resolver.listCandidates({
      ...scope,
      linkage: 'any',
      page: 1,
      pageSize: 25,
    })).rejects.toBe(failure)
  })
})
