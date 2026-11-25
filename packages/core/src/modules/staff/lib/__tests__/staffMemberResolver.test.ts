import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getStaffMemberByUserId, getStaffMembersByUserId } from '../staffMemberResolver'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const mockedFind = jest.mocked(findWithDecryption)
const em = {} as EntityManager
const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const orgA = '00000000-0000-4000-8000-00000000000a'
const userId = '00000000-0000-4000-8000-000000000001'
const memberA = { id: '00000000-0000-4000-8000-0000000000aa' }
const memberB = { id: '00000000-0000-4000-8000-0000000000bb' }

describe('staffMemberResolver (#10188)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedFind.mockResolvedValue([memberA] as never)
  })

  it('binds the trusted tenant and organization in the lookup, not only in the decryption scope', async () => {
    await expect(getStaffMemberByUserId(em, userId, tenantId, orgA)).resolves.toBe(memberA)
    expect(mockedFind).toHaveBeenCalledWith(
      em,
      expect.anything(),
      { userId, tenantId, organizationId: orgA, deletedAt: null },
      expect.anything(),
      { tenantId, organizationId: orgA },
    )
  })

  it('looks up tenant-wide when no organization is in scope and reads the empty sentinel as missing', async () => {
    await expect(getStaffMemberByUserId(em, userId, tenantId, '')).resolves.toBe(memberA)
    expect(mockedFind).toHaveBeenCalledWith(
      em,
      expect.anything(),
      { userId, tenantId, deletedAt: null },
      expect.anything(),
      { tenantId, organizationId: null },
    )
  })

  it('returns null instead of an arbitrary member when the user is staff in several organizations', async () => {
    mockedFind.mockResolvedValue([memberA, memberB] as never)

    await expect(getStaffMemberByUserId(em, userId, tenantId, null)).resolves.toBeNull()
    await expect(getStaffMembersByUserId(em, userId, tenantId, null)).resolves.toEqual([memberA, memberB])
  })

  it.each([
    ['an API key subject', 'api_key:00000000-0000-4000-8000-0000000000cc', tenantId, orgA],
    ['a missing tenant', userId, null, orgA],
    ['an empty tenant', userId, '', null],
    ['a non-uuid organization', userId, tenantId, 'not-a-uuid'],
  ])('never queries for %s', async (_label, principal, tenant, organization) => {
    await expect(getStaffMemberByUserId(em, principal, tenant, organization)).resolves.toBeNull()
    await expect(getStaffMembersByUserId(em, principal, tenant, organization)).resolves.toEqual([])
    expect(mockedFind).not.toHaveBeenCalled()
  })
})
