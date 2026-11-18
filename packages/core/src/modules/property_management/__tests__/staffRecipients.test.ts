/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { BuildingManager } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

import { resolveStaffRecipients } from '../lib/staffRecipients'

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

type Grant = { userId: string; features: unknown; superAdmin?: boolean; via?: 'user' | 'role' }

function seedUser(em: FakeEm, id: string, organizationId: string | null = scope.organizationId, deletedAt: Date | null = null) {
  em.seed(User, { id, tenantId: scope.tenantId, organizationId, deletedAt } as never)
}

const aclGrants = new WeakMap<FakeEm, Grant[]>()

function withAcls(em: FakeEm, grants: Grant[]) {
  aclGrants.set(em, [...(aclGrants.get(em) ?? []), ...grants])
  em.respond = (sql, params) => {
    const via = sql.includes('from user_acls') ? 'user' : sql.includes('from role_acls') ? 'role' : null
    if (!via) return []
    const [tenantId] = params as string[]
    const organizationId = params[params.length - 1]
    const visible = new Set(
      em
        .rows(User)
        .filter((row) => row.tenantId === tenantId && !row.deletedAt && (row.organizationId === organizationId || row.organizationId === null))
        .map((row) => row.id),
    )
    return (aclGrants.get(em) ?? [])
      .filter((grant) => (grant.via ?? 'role') === via && visible.has(grant.userId))
      .map((grant) => ({ user_id: grant.userId, features_json: grant.features, is_super_admin: grant.superAdmin ?? false }))
  }
}

const MANAGE_ALL = ['property_management.buildings.manage_all']

describe('resolveStaffRecipients', () => {
  it('returns the building managers and the organization administrators, deduplicated', async () => {
    const em = new FakeEm()
    for (const id of ['manager-a', 'manager-b', 'admin-1', 'employee-1']) seedUser(em, id)
    em.seed(BuildingManager, { id: 'bm1', ...scope, buildingId: 'building-a', userId: 'manager-a' } as never)
    em.seed(BuildingManager, { id: 'bm2', ...scope, buildingId: 'building-b', userId: 'manager-b' } as never)
    em.seed(BuildingManager, { id: 'bm3', ...scope, buildingId: 'building-a', userId: 'admin-1' } as never)
    withAcls(em, [{ userId: 'admin-1', features: MANAGE_ALL }, { userId: 'employee-1', features: ['property_management.view'] }])
    const calls: Array<{ userId: string; scope: unknown }> = []
    const recipients = await resolveStaffRecipients({
      container: containerWith(new Set(['admin-1']), calls),
      em: em as never,
      scope,
      buildingId: 'building-a',
    })
    expect(recipients).toEqual(['admin-1', 'manager-a'])
    expect(calls.map((call) => call.userId)).toEqual(['admin-1'])
    expect(calls.every((call) => JSON.stringify(call.scope) === JSON.stringify(scope))).toBe(true)
  })

  it('skips deleted managers and users of another organization', async () => {
    const em = new FakeEm()
    seedUser(em, 'manager-gone', scope.organizationId, new Date())
    seedUser(em, 'foreign-admin', OTHER_ORG)
    em.seed(BuildingManager, { id: 'bm1', ...scope, buildingId: 'building-a', userId: 'manager-gone' } as never)
    withAcls(em, [{ userId: 'foreign-admin', features: MANAGE_ALL }])
    const recipients = await resolveStaffRecipients({
      container: containerWith(new Set(['foreign-admin'])),
      em: em as never,
      scope,
      buildingId: 'building-a',
    })
    expect(recipients).toEqual([])
  })

  it('skips a building manager who now belongs to another organization of the tenant', async () => {
    const em = new FakeEm()
    seedUser(em, 'manager-here')
    seedUser(em, 'manager-moved', OTHER_ORG)
    em.seed(BuildingManager, { id: 'bm1', ...scope, buildingId: 'building-a', userId: 'manager-here' } as never)
    em.seed(BuildingManager, { id: 'bm2', ...scope, buildingId: 'building-a', userId: 'manager-moved' } as never)
    withAcls(em, [])
    const recipients = await resolveStaffRecipients({
      container: containerWith(new Set()),
      em: em as never,
      scope,
      buildingId: 'building-a',
    })
    expect(recipients).toEqual(['manager-here'])
  })

  it('addresses only administrators for the administrators audience', async () => {
    const em = new FakeEm()
    seedUser(em, 'manager-a')
    seedUser(em, 'admin-1')
    em.seed(BuildingManager, { id: 'bm1', ...scope, buildingId: 'building-a', userId: 'manager-a' } as never)
    withAcls(em, [{ userId: 'admin-1', features: MANAGE_ALL, via: 'user' }])
    const recipients = await resolveStaffRecipients({
      container: containerWith(new Set(['admin-1'])),
      em: em as never,
      scope,
      buildingId: 'building-a',
      audience: 'administrators',
    })
    expect(recipients).toEqual(['admin-1'])
  })

  it('finds every holder in a large tenant from the ACL rows, wildcard-aware, without scanning all users', async () => {
    const em = new FakeEm()
    const ids = Array.from({ length: 450 }, (_, index) => `user-${String(index).padStart(4, '0')}`)
    for (const id of ids) seedUser(em, id)
    withAcls(em, [
      ...ids.map((userId) => ({ userId, features: ['property_management.view'] })),
      { userId: 'user-0449', features: ['property_management.*'] },
      { userId: 'user-0300', features: '["property_management.buildings.*"]', via: 'user' as const },
      { userId: 'user-0420', features: [], superAdmin: true },
    ])
    const calls: Array<{ userId: string; scope: unknown }> = []
    const recipients = await resolveStaffRecipients({
      container: containerWith(new Set(['user-0449', 'user-0300', 'user-0420']), calls),
      em: em as never,
      scope,
      buildingId: null,
    })
    expect(calls.map((call) => call.userId)).toEqual(['user-0300', 'user-0420', 'user-0449'])
    expect(recipients).toEqual(['user-0300', 'user-0420', 'user-0449'])
    expect(em.executed.map((entry) => entry.sql).every((sql) => sql.includes('users.organization_id = ?'))).toBe(true)
  })

  it('confirms candidates with the rbac service so a user ACL can narrow a role grant', async () => {
    const em = new FakeEm()
    seedUser(em, 'narrowed')
    withAcls(em, [{ userId: 'narrowed', features: MANAGE_ALL }])
    const recipients = await resolveStaffRecipients({ container: containerWith(new Set()), em: em as never, scope, buildingId: null })
    expect(recipients).toEqual([])
  })
})
