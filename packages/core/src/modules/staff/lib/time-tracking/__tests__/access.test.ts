import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMember, StaffTimeProjectMember } from '../../../data/entities'
import {
  assertProjectAccess,
  isWithinAssignmentWindow,
  normalizeAssignmentGraceDays,
  resolveProjectAccess,
} from '../access'

type Row = Record<string, unknown>

const TENANT = 'tenant-1'
const OTHER_TENANT = 'tenant-2'
const ORG = 'org-1'
const OTHER_ORG = 'org-2'

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    return actual === (expected ?? null)
  })
}

function createEm(rows: { members?: Row[]; memberships?: Row[] }): EntityManager {
  const tableFor = (entityName: unknown): Row[] => {
    if (entityName === StaffTeamMember) return rows.members ?? []
    if (entityName === StaffTimeProjectMember) return rows.memberships ?? []
    throw new Error('[internal] unexpected entity in access test fake EntityManager')
  }
  const em = {
    find: async (entityName: unknown, where: Row) => tableFor(entityName).filter((row) => matches(row, where)),
    findOne: async (entityName: unknown, where: Row) =>
      tableFor(entityName).find((row) => matches(row, where)) ?? null,
  }
  return em as unknown as EntityManager
}

const staffMemberRow = (overrides: Row = {}): Row => ({
  id: 'member-1',
  userId: 'user-1',
  tenantId: TENANT,
  organizationId: ORG,
  deletedAt: null,
  ...overrides,
})

const membershipRow = (overrides: Row = {}): Row => ({
  id: 'assignment-1',
  staffMemberId: 'member-1',
  timeProjectId: 'project-1',
  tenantId: TENANT,
  organizationId: ORG,
  status: 'active',
  deletedAt: null,
  ...overrides,
})

const baseCtx = {
  userId: 'user-1',
  tenantId: TENANT,
  organizationId: ORG,
}

describe('resolveProjectAccess', () => {
  it('grants unrestricted access to a projects.manage holder', async () => {
    const em = createEm({ members: [staffMemberRow()], memberships: [membershipRow()] })
    const access = await resolveProjectAccess({
      em,
      ...baseCtx,
      userFeatures: ['staff.timesheets.view', 'staff.timesheets.projects.manage'],
    })
    expect(access).toEqual({ canManageAll: true, projectIds: [], staffMemberId: 'member-1' })
  })

  it('honours a wildcard grant for the manage feature', async () => {
    const em = createEm({ members: [staffMemberRow()] })
    const access = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.*'] })
    expect(access.canManageAll).toBe(true)

    const nested = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.timesheets.*'] })
    expect(nested.canManageAll).toBe(true)
  })

  it('returns the active memberships of a caller without the manage feature', async () => {
    const em = createEm({
      members: [staffMemberRow()],
      memberships: [
        membershipRow(),
        membershipRow({ id: 'assignment-2', timeProjectId: 'project-2' }),
      ],
    })
    const access = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.timesheets.view'] })
    expect(access).toEqual({
      canManageAll: false,
      projectIds: ['project-1', 'project-2'],
      staffMemberId: 'member-1',
    })
  })

  it('returns no projects for a staff member with no membership', async () => {
    const em = createEm({ members: [staffMemberRow()], memberships: [] })
    const access = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.timesheets.view'] })
    expect(access).toEqual({ canManageAll: false, projectIds: [], staffMemberId: 'member-1' })
  })

  it('ignores an inactive membership', async () => {
    const em = createEm({
      members: [staffMemberRow()],
      memberships: [membershipRow({ status: 'inactive' })],
    })
    const access = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.timesheets.view'] })
    expect(access.projectIds).toEqual([])
  })

  it('ignores a soft-deleted membership', async () => {
    const em = createEm({
      members: [staffMemberRow()],
      memberships: [membershipRow({ deletedAt: new Date('2026-08-01T00:00:00.000Z') })],
    })
    const access = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.timesheets.view'] })
    expect(access.projectIds).toEqual([])
  })

  it('treats a caller with no staff member profile as a normal empty result', async () => {
    const em = createEm({ members: [], memberships: [membershipRow()] })
    const access = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.timesheets.view'] })
    expect(access).toEqual({ canManageAll: false, projectIds: [], staffMemberId: null })
  })

  it('ignores a soft-deleted staff member profile', async () => {
    const em = createEm({
      members: [staffMemberRow({ deletedAt: new Date('2026-08-01T00:00:00.000Z') })],
      memberships: [membershipRow()],
    })
    const access = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.timesheets.view'] })
    expect(access.staffMemberId).toBeNull()
    expect(access.projectIds).toEqual([])
  })

  it('never leaks a staff member or project from another tenant', async () => {
    const em = createEm({
      members: [staffMemberRow({ tenantId: OTHER_TENANT })],
      memberships: [membershipRow({ tenantId: OTHER_TENANT })],
    })
    const access = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.timesheets.view'] })
    expect(access).toEqual({ canManageAll: false, projectIds: [], staffMemberId: null })
  })

  it('never leaks a membership from another organization', async () => {
    const em = createEm({
      members: [staffMemberRow()],
      memberships: [
        membershipRow({ organizationId: OTHER_ORG, timeProjectId: 'project-other-org' }),
        membershipRow({ id: 'assignment-3', timeProjectId: 'project-3' }),
      ],
    })
    const access = await resolveProjectAccess({ em, ...baseCtx, userFeatures: ['staff.timesheets.view'] })
    expect(access.projectIds).toEqual(['project-3'])
  })

  it('fails closed when the request has no tenant or organization scope', async () => {
    const em = createEm({ members: [staffMemberRow()], memberships: [membershipRow()] })
    const noTenant = await resolveProjectAccess({
      em,
      userId: 'user-1',
      tenantId: null,
      organizationId: ORG,
      userFeatures: ['staff.timesheets.projects.manage'],
    })
    expect(noTenant).toEqual({ canManageAll: false, projectIds: [], staffMemberId: null })

    const noOrg = await resolveProjectAccess({
      em,
      userId: 'user-1',
      tenantId: TENANT,
      organizationId: null,
      userFeatures: ['staff.timesheets.projects.manage'],
    })
    expect(noOrg).toEqual({ canManageAll: false, projectIds: [], staffMemberId: null })
  })

  it('fails closed when there is no authenticated user', async () => {
    const em = createEm({ members: [staffMemberRow()], memberships: [membershipRow()] })
    const access = await resolveProjectAccess({ em, ...baseCtx, userId: null, userFeatures: [] })
    expect(access).toEqual({ canManageAll: false, projectIds: [], staffMemberId: null })
  })
})

describe('resolveProjectAccess assignment window', () => {
  const NOW = new Date(2026, 7, 12, 9, 30)

  const dayOffset = (days: number): Date => new Date(2026, 7, 12 + days)

  const isoDayOffset = (days: number): string => {
    const date = dayOffset(days)
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }

  const assignedMembershipRow = (overrides: Row = {}): Row =>
    membershipRow({ assignedStartDate: dayOffset(-120), ...overrides })

  async function resolveWith(rows: Row[], options: { graceDays?: number | null; now?: Date } = {}) {
    const em = createEm({ members: [staffMemberRow()], memberships: rows })
    return resolveProjectAccess({
      em,
      ...baseCtx,
      userFeatures: ['staff.timesheets.view'],
      assignmentGraceDays: options.graceDays,
      now: options.now ?? NOW,
    })
  }

  it('grants access when the assignment ended yesterday and the grace is 14 days', async () => {
    const access = await resolveWith([assignedMembershipRow({ assignedEndDate: dayOffset(-1) })], {
      graceDays: 14,
    })
    expect(access.projectIds).toEqual(['project-1'])
  })

  it('denies access when the assignment ended 15 days ago and the grace is 14 days', async () => {
    const access = await resolveWith([assignedMembershipRow({ assignedEndDate: dayOffset(-15) })], {
      graceDays: 14,
    })
    expect(access.projectIds).toEqual([])
  })

  it('treats the last day of the grace window as inclusive', async () => {
    const access = await resolveWith([assignedMembershipRow({ assignedEndDate: dayOffset(-14) })], {
      graceDays: 14,
    })
    expect(access.projectIds).toEqual(['project-1'])
  })

  it('grants access on the assignment end date itself', async () => {
    const access = await resolveWith([assignedMembershipRow({ assignedEndDate: dayOffset(0) })], {
      graceDays: 14,
    })
    expect(access.projectIds).toEqual(['project-1'])
  })

  it('never expires an open-ended assignment', async () => {
    const access = await resolveWith(
      [assignedMembershipRow({ assignedStartDate: dayOffset(-2000), assignedEndDate: null })],
      { graceDays: 0 },
    )
    expect(access.projectIds).toEqual(['project-1'])
  })

  it('denies an assignment that has not started yet', async () => {
    const access = await resolveWith(
      [assignedMembershipRow({ assignedStartDate: dayOffset(1), assignedEndDate: null })],
      { graceDays: 14 },
    )
    expect(access.projectIds).toEqual([])
  })

  it('grants an assignment that starts today', async () => {
    const access = await resolveWith(
      [assignedMembershipRow({ assignedStartDate: dayOffset(0), assignedEndDate: null })],
      { graceDays: 14 },
    )
    expect(access.projectIds).toEqual(['project-1'])
  })

  it('ends access the day after the assignment when the grace is zero', async () => {
    const denied = await resolveWith([assignedMembershipRow({ assignedEndDate: dayOffset(-1) })], {
      graceDays: 0,
    })
    expect(denied.projectIds).toEqual([])

    const granted = await resolveWith([assignedMembershipRow({ assignedEndDate: dayOffset(0) })], {
      graceDays: 0,
    })
    expect(granted.projectIds).toEqual(['project-1'])
  })

  it('leaves a manage-all caller unaffected by a long-expired membership', async () => {
    const em = createEm({
      members: [staffMemberRow()],
      memberships: [
        membershipRow({ assignedStartDate: dayOffset(-800), assignedEndDate: dayOffset(-400) }),
      ],
    })
    const access = await resolveProjectAccess({
      em,
      ...baseCtx,
      userFeatures: ['staff.timesheets.projects.manage'],
      assignmentGraceDays: 0,
      now: NOW,
    })
    expect(access).toEqual({ canManageAll: true, projectIds: [], staffMemberId: 'member-1' })
  })

  it('falls back to the 14 day default when no grace is supplied', async () => {
    const granted = await resolveWith([assignedMembershipRow({ assignedEndDate: dayOffset(-14) })])
    expect(granted.projectIds).toEqual(['project-1'])

    const denied = await resolveWith([assignedMembershipRow({ assignedEndDate: dayOffset(-15) })])
    expect(denied.projectIds).toEqual([])
  })

  it('compares date columns materialised as ISO date strings', async () => {
    const granted = await resolveWith(
      [
        assignedMembershipRow({
          assignedStartDate: isoDayOffset(-30),
          assignedEndDate: isoDayOffset(-3),
        }),
      ],
      { graceDays: 14 },
    )
    expect(granted.projectIds).toEqual(['project-1'])

    const denied = await resolveWith(
      [
        assignedMembershipRow({
          assignedStartDate: isoDayOffset(-30),
          assignedEndDate: isoDayOffset(-20),
        }),
      ],
      { graceDays: 14 },
    )
    expect(denied.projectIds).toEqual([])
  })

  it('keeps a project reachable through a still-open assignment when an older one expired', async () => {
    const access = await resolveWith(
      [
        assignedMembershipRow({ assignedEndDate: dayOffset(-400) }),
        assignedMembershipRow({ id: 'assignment-2', assignedEndDate: null }),
      ],
      { graceDays: 14 },
    )
    expect(access.projectIds).toEqual(['project-1'])
  })

  it('denies every membership when the injected clock is unusable', async () => {
    const access = await resolveWith([assignedMembershipRow({ assignedEndDate: null })], {
      now: new Date('not-a-date'),
    })
    expect(access.projectIds).toEqual([])
  })
})

describe('normalizeAssignmentGraceDays', () => {
  it('keeps a valid non-negative integer, including zero', () => {
    expect(normalizeAssignmentGraceDays(0)).toBe(0)
    expect(normalizeAssignmentGraceDays(30)).toBe(30)
    expect(normalizeAssignmentGraceDays(365)).toBe(365)
  })

  it('falls back to the default for absent or invalid values', () => {
    expect(normalizeAssignmentGraceDays(undefined)).toBe(14)
    expect(normalizeAssignmentGraceDays(null)).toBe(14)
    expect(normalizeAssignmentGraceDays(-1)).toBe(14)
    expect(normalizeAssignmentGraceDays(1.5)).toBe(14)
    expect(normalizeAssignmentGraceDays(366)).toBe(14)
    expect(normalizeAssignmentGraceDays('7')).toBe(14)
    expect(normalizeAssignmentGraceDays(Number.NaN)).toBe(14)
  })
})

describe('isWithinAssignmentWindow', () => {
  const todayIndex = Date.UTC(2026, 7, 12) / 86_400_000

  it('is agnostic to the time of day stored on a date column', () => {
    expect(
      isWithinAssignmentWindow(
        {
          assignedStartDate: new Date(2026, 7, 12, 23, 59),
          assignedEndDate: new Date(2026, 7, 12, 0, 0),
        } as never,
        todayIndex,
        0,
      ),
    ).toBe(true)
  })

  it('fails closed on an unparseable bound', () => {
    expect(
      isWithinAssignmentWindow(
        { assignedStartDate: 'not-a-date', assignedEndDate: null } as never,
        todayIndex,
        14,
      ),
    ).toBe(false)
  })
})

describe('assertProjectAccess', () => {
  const membershipAccess = { canManageAll: false, projectIds: ['project-1'], staffMemberId: 'member-1' }

  it('allows any project for a manage-all caller', () => {
    const manageAll = { canManageAll: true, projectIds: [], staffMemberId: null }
    expect(assertProjectAccess(manageAll, 'project-9')).toBe(true)
  })

  it('allows an assigned project and denies an unassigned one', () => {
    expect(assertProjectAccess(membershipAccess, 'project-1')).toBe(true)
    expect(assertProjectAccess(membershipAccess, 'project-2')).toBe(false)
  })

  it('denies a missing project id for a membership-scoped caller', () => {
    expect(assertProjectAccess(membershipAccess, null)).toBe(false)
    expect(assertProjectAccess(membershipAccess, undefined)).toBe(false)
  })
})
