/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { BuildingManager } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

import { MANAGE_ALL_CANDIDATE_CAP, resolveStaffRecipients } from '../lib/staffRecipients'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const OTHER_ORG = '33333333-3333-4333-8333-333333333333'

function containerWith(holders: Set<string>, calls: Array<{ userId: string; scope: unknown }> = []) {
  const rbacService = {
    userHasAllFeatures: jest.fn(async (userId: string, features: string[], featureScope: unknown) => {
      calls.push({ userId, scope: featureScope })
      return features.every((feature) => feature === 'property_management.buildings.manage_all') && holders.has(userId)
    }),
  }
  return { resolve: jest.fn(() => rbacService) } as unknown as AwilixContainer
}

function seedUser(em: FakeEm, id: string, organizationId: string | null = scope.organizationId, deletedAt: Date | null = null) {
  em.seed(User, { id, tenantId: scope.tenantId, organizationId, deletedAt } as never)
}

describe('resolveStaffRecipients', () => {
  it('returns the building managers and the organization administrators, deduplicated', async () => {
    const em = new FakeEm()
    for (const id of ['manager-a', 'manager-b', 'admin-1', 'employee-1']) seedUser(em, id)
    em.seed(BuildingManager, { id: 'bm1', ...scope, buildingId: 'building-a', userId: 'manager-a' } as never)
    em.seed(BuildingManager, { id: 'bm2', ...scope, buildingId: 'building-b', userId: 'manager-b' } as never)
    em.seed(BuildingManager, { id: 'bm3', ...scope, buildingId: 'building-a', userId: 'admin-1' } as never)
    const calls: Array<{ userId: string; scope: unknown }> = []
    const recipients = await resolveStaffRecipients({
      container: containerWith(new Set(['admin-1']), calls),
      em: em as never,
      scope,
      buildingId: 'building-a',
    })
    expect(recipients).toEqual(['admin-1', 'manager-a'])
    expect(calls.every((call) => JSON.stringify(call.scope) === JSON.stringify(scope))).toBe(true)
  })

  it('skips deleted managers and users of another organization', async () => {
    const em = new FakeEm()
    seedUser(em, 'manager-gone', scope.organizationId, new Date())
    seedUser(em, 'foreign-admin', OTHER_ORG)
    em.seed(BuildingManager, { id: 'bm1', ...scope, buildingId: 'building-a', userId: 'manager-gone' } as never)
    const recipients = await resolveStaffRecipients({
      container: containerWith(new Set(['foreign-admin'])),
      em: em as never,
      scope,
      buildingId: 'building-a',
    })
    expect(recipients).toEqual([])
  })

  it('addresses only administrators for the administrators audience', async () => {
    const em = new FakeEm()
    seedUser(em, 'manager-a')
    seedUser(em, 'admin-1')
    em.seed(BuildingManager, { id: 'bm1', ...scope, buildingId: 'building-a', userId: 'manager-a' } as never)
    const recipients = await resolveStaffRecipients({
      container: containerWith(new Set(['admin-1'])),
      em: em as never,
      scope,
      buildingId: 'building-a',
      audience: 'administrators',
    })
    expect(recipients).toEqual(['admin-1'])
  })

  it('checks at most the candidate cap and still returns the holders found', async () => {
    const em = new FakeEm()
    const ids = Array.from({ length: MANAGE_ALL_CANDIDATE_CAP + 5 }, (_, index) => `user-${String(index).padStart(4, '0')}`)
    for (const id of ids) seedUser(em, id)
    const calls: Array<{ userId: string; scope: unknown }> = []
    const recipients = await resolveStaffRecipients({
      container: containerWith(new Set(['user-0000', ids[ids.length - 1]]), calls),
      em: em as never,
      scope,
      buildingId: null,
    })
    expect(calls).toHaveLength(MANAGE_ALL_CANDIDATE_CAP)
    expect(recipients).toEqual(['user-0000'])
  })
})
