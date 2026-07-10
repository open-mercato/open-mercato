/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember } from '../../data/entities'
import { DefaultStaffMemberDirectory } from '../staffMemberDirectory'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))

const findMock = jest.mocked(findWithDecryption)

beforeEach(() => {
  findMock.mockReset()
})

it('returns only active scoped scheduling references for requested users', async () => {
  const em = {} as EntityManager
  findMock.mockResolvedValueOnce([{
    userId: '11111111-1111-4111-8111-111111111111',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    availabilityRuleSetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    displayName: 'Staff Member A',
  }] as never)

  const directory = new DefaultStaffMemberDirectory(em)
  await expect(directory.listActiveSchedulingRefs({
    userIds: ['11111111-1111-4111-8111-111111111111'],
    tenantId: '22222222-2222-4222-8222-222222222222',
    organizationId: '33333333-3333-4333-8333-333333333333',
  })).resolves.toEqual([{
    userId: '11111111-1111-4111-8111-111111111111',
    staffMemberId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    availabilityRuleSetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    displayName: 'Staff Member A',
  }])
  expect(findMock).toHaveBeenCalledWith(
    em,
    StaffTeamMember,
    {
      userId: { $in: ['11111111-1111-4111-8111-111111111111'] },
      tenantId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
      isActive: true,
      deletedAt: null,
    },
    { orderBy: { displayName: 'asc', id: 'asc' } },
    {
      tenantId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
    },
  )
})

it('returns an empty list without querying when no user ids are requested', async () => {
  const directory = new DefaultStaffMemberDirectory({} as EntityManager)

  await expect(directory.listActiveSchedulingRefs({
    userIds: [],
    tenantId: '22222222-2222-4222-8222-222222222222',
    organizationId: '33333333-3333-4333-8333-333333333333',
  })).resolves.toEqual([])
  expect(findMock).not.toHaveBeenCalled()
})
