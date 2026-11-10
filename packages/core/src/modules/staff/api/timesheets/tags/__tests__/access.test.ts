/**
 * `loadTagProjectAccess` is one of the call sites that used to hand-roll its own
 * RBAC read and then let `resolveProjectAccess` re-derive the manage-all decision
 * by matching that array locally. Both halves are now one question asked once of
 * `resolveFeatureAccess`, so what this file pins down is the direction of every
 * failure: an RBAC that cannot answer must never widen access, and a grant array
 * must never be able to answer on the service's behalf.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMember, StaffTimeProjectMember } from '../../../../data/entities'
import { loadTagProjectAccess } from '../access'

type Row = Record<string, unknown>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const MEMBER_ID = '55555555-5555-4555-8555-555555555555'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const MANAGE_PROJECTS_FEATURE = 'staff.timesheets.projects.manage'

const scope = { tenantId: TENANT_ID, organizationId: ORG_ID, userId: USER_ID }

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => (row[key] ?? null) === (expected ?? null))
}

function createEm(): EntityManager {
  const members: Row[] = [
    { id: MEMBER_ID, userId: USER_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
  ]
  const memberships: Row[] = [
    {
      id: 'membership-1',
      staffMemberId: MEMBER_ID,
      timeProjectId: PROJECT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      status: 'active',
      deletedAt: null,
      assignedStartDate: null,
      assignedEndDate: null,
    },
  ]
  const tableFor = (entityName: unknown): Row[] => {
    if (entityName === StaffTeamMember) return members
    if (entityName === StaffTimeProjectMember) return memberships
    throw new Error('[internal] unexpected entity in tag access test fake EntityManager')
  }
  const em: Record<string, unknown> = {
    find: async (entityName: unknown, where: Row) => tableFor(entityName).filter((row) => matches(row, where)),
    findOne: async (entityName: unknown, where: Row) =>
      tableFor(entityName).find((row) => matches(row, where)) ?? null,
  }
  em.fork = () => em
  return em as unknown as EntityManager
}

function createContainer(rbacService: unknown, options: { rbacResolvable?: boolean } = {}) {
  return {
    resolve: (token: string) => {
      if (token === 'rbacService') {
        if (options.rbacResolvable === false) throw new Error('[internal] rbacService is not registered')
        return rbacService
      }
      if (token === 'em') return createEm()
      throw new Error(`[internal] unexpected container resolve: ${token}`)
    },
  }
}

describe('loadTagProjectAccess', () => {
  it('asks the single authority for the manage-all decision, not the grant array', async () => {
    const userHasAllFeatures = jest.fn(async () => true)
    const access = await loadTagProjectAccess(
      createContainer({ userHasAllFeatures, getGrantedFeatures: async () => [] }),
      scope,
    )

    expect(userHasAllFeatures).toHaveBeenCalledWith(USER_ID, [MANAGE_PROJECTS_FEATURE], {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(access.canManageAll).toBe(true)
    expect(access.staffMemberId).toBe(MEMBER_ID)
  })

  it('refuses manage-all when the service refuses it, even though the grant array names the feature', async () => {
    const access = await loadTagProjectAccess(
      createContainer({
        userHasAllFeatures: async () => false,
        getGrantedFeatures: async () => [MANAGE_PROJECTS_FEATURE, 'staff.*'],
      }),
      scope,
    )

    expect(access.canManageAll).toBe(false)
    expect(access.projectIds).toEqual([PROJECT_ID])
  })

  it('fails closed when the feature check throws', async () => {
    const access = await loadTagProjectAccess(
      createContainer({
        userHasAllFeatures: async () => {
          throw new Error('[internal] rbac unavailable')
        },
        getGrantedFeatures: async () => [MANAGE_PROJECTS_FEATURE],
      }),
      scope,
    )

    expect(access.canManageAll).toBe(false)
    expect(access.projectIds).toEqual([PROJECT_ID])
  })

  it('fails closed when the service cannot answer feature checks at all', async () => {
    const access = await loadTagProjectAccess(
      createContainer({ getGrantedFeatures: async () => [MANAGE_PROJECTS_FEATURE] }),
      scope,
    )

    expect(access.canManageAll).toBe(false)
  })

  it('fails closed when rbacService cannot be resolved', async () => {
    const access = await loadTagProjectAccess(createContainer(undefined, { rbacResolvable: false }), scope)

    expect(access.canManageAll).toBe(false)
    expect(access.projectIds).toEqual([PROJECT_ID])
  })

  it('does not widen access when the grant list is unreadable but the decision stands', async () => {
    const access = await loadTagProjectAccess(
      createContainer({
        userHasAllFeatures: async () => false,
        getGrantedFeatures: async () => {
          throw new Error('[internal] grant list unavailable')
        },
      }),
      scope,
    )

    expect(access.canManageAll).toBe(false)
    expect(access.projectIds).toEqual([PROJECT_ID])
  })
})
