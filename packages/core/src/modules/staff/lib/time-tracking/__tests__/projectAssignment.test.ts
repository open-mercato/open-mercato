/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (em: { find: Function }, cls: unknown, where: unknown) => em.find(cls, where)),
}))

import {
  isActiveAssignment,
  isActiveProjectAssigner,
  resolveUsableDefaultAssignee,
} from '../projectAssignment'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const PROJECT_ID = 'project-1'
const NOW = new Date(2026, 9, 14, 12, 0, 0)

type MembershipRow = {
  id: string
  timeProjectId: string
  staffMemberId: string
  status: 'active' | 'inactive'
  deletedAt: Date | null
  assignedStartDate: Date | string | null
  assignedEndDate: Date | string | null
  isAssigner: boolean
}

function membership(overrides: Partial<MembershipRow> & Pick<MembershipRow, 'id' | 'staffMemberId'>): MembershipRow {
  return {
    timeProjectId: PROJECT_ID,
    status: 'active',
    deletedAt: null,
    assignedStartDate: null,
    assignedEndDate: null,
    isAssigner: false,
    ...overrides,
  }
}

function makeEm(memberships: MembershipRow[], staffMembers: { id: string; userId: string | null }[]): EntityManager {
  const find = jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
    if (cls.name === 'StaffTimeProjectMember') {
      return memberships.filter((row) => {
        if (row.timeProjectId !== where.timeProjectId) return false
        if (where.isAssigner === true && !row.isAssigner) return false
        return row.status === where.status && row.deletedAt === null
      })
    }
    if (cls.name === 'StaffTeamMember') {
      const ids = (where.id as { $in: string[] }).$in
      return staffMembers.filter((member) => ids.includes(member.id))
    }
    return []
  })
  return { find } as unknown as EntityManager
}

describe('isActiveAssignment', () => {
  it('accepts an active, open-ended membership', () => {
    expect(isActiveAssignment(membership({ id: 'm1', staffMemberId: 's1' }), NOW, 0)).toBe(true)
  })

  it('rejects an inactive or soft-deleted membership', () => {
    expect(isActiveAssignment(membership({ id: 'm1', staffMemberId: 's1', status: 'inactive' }), NOW, 0)).toBe(false)
    expect(isActiveAssignment(membership({ id: 'm1', staffMemberId: 's1', deletedAt: new Date() }), NOW, 0)).toBe(false)
  })

  it('rejects a membership that starts tomorrow and accepts one that starts today', () => {
    expect(isActiveAssignment(membership({ id: 'm1', staffMemberId: 's1', assignedStartDate: '2026-10-15' }), NOW, 0)).toBe(false)
    expect(isActiveAssignment(membership({ id: 'm1', staffMemberId: 's1', assignedStartDate: '2026-10-14' }), NOW, 0)).toBe(true)
  })

  it('keeps a membership ending today and drops one that ended yesterday without grace', () => {
    expect(isActiveAssignment(membership({ id: 'm1', staffMemberId: 's1', assignedEndDate: '2026-10-14' }), NOW, 0)).toBe(true)
    expect(isActiveAssignment(membership({ id: 'm1', staffMemberId: 's1', assignedEndDate: '2026-10-13' }), NOW, 0)).toBe(false)
  })

  it('extends the window by exactly the grace days', () => {
    const ended = membership({ id: 'm1', staffMemberId: 's1', assignedEndDate: '2026-10-11' })
    expect(isActiveAssignment(ended, NOW, 3)).toBe(true)
    expect(isActiveAssignment(ended, NOW, 2)).toBe(false)
  })

  it('reads Date bounds by their local calendar day', () => {
    const ended = membership({ id: 'm1', staffMemberId: 's1', assignedEndDate: new Date(2026, 9, 14, 0, 0, 0) })
    expect(isActiveAssignment(ended, NOW, 0)).toBe(true)
  })
})

describe('isActiveProjectAssigner', () => {
  it('is true only for an active assigner membership inside its window', async () => {
    const em = makeEm(
      [
        membership({ id: 'm1', staffMemberId: 'assigner', isAssigner: true }),
        membership({ id: 'm2', staffMemberId: 'plain-member' }),
        membership({ id: 'm3', staffMemberId: 'expired-assigner', isAssigner: true, assignedEndDate: '2026-01-01' }),
      ],
      [
        { id: 'assigner', userId: 'user-a' },
        { id: 'plain-member', userId: 'user-b' },
        { id: 'expired-assigner', userId: 'user-c' },
      ],
    )
    await expect(isActiveProjectAssigner(em, SCOPE, PROJECT_ID, 'assigner', { now: NOW, graceDays: 0 })).resolves.toBe(true)
    await expect(isActiveProjectAssigner(em, SCOPE, PROJECT_ID, 'plain-member', { now: NOW, graceDays: 0 })).resolves.toBe(false)
    await expect(isActiveProjectAssigner(em, SCOPE, PROJECT_ID, 'expired-assigner', { now: NOW, graceDays: 0 })).resolves.toBe(false)
  })

  it('ignores a membership whose staff member no longer exists', async () => {
    const em = makeEm([membership({ id: 'm1', staffMemberId: 'ghost', isAssigner: true })], [])
    await expect(isActiveProjectAssigner(em, SCOPE, PROJECT_ID, 'ghost', { now: NOW })).resolves.toBe(false)
  })
})

describe('resolveUsableDefaultAssignee', () => {
  it('returns null when the project has no default assignee', async () => {
    const em = makeEm([], [])
    await expect(resolveUsableDefaultAssignee(em, SCOPE, { id: PROJECT_ID, defaultAssigneeStaffMemberId: null })).resolves.toBeNull()
    expect((em.find as jest.Mock)).not.toHaveBeenCalled()
  })

  it('returns the default assignee while they are an active member', async () => {
    const em = makeEm([membership({ id: 'm1', staffMemberId: 'default' })], [{ id: 'default', userId: 'user-d' }])
    await expect(
      resolveUsableDefaultAssignee(em, SCOPE, { id: PROJECT_ID, defaultAssigneeStaffMemberId: 'default' }, { now: NOW }),
    ).resolves.toBe('default')
  })

  it('drops a default assignee whose membership expired past the grace window', async () => {
    const em = makeEm(
      [membership({ id: 'm1', staffMemberId: 'default', assignedEndDate: '2026-10-10' })],
      [{ id: 'default', userId: 'user-d' }],
    )
    const project = { id: PROJECT_ID, defaultAssigneeStaffMemberId: 'default' }
    await expect(resolveUsableDefaultAssignee(em, SCOPE, project, { now: NOW, graceDays: 4 })).resolves.toBe('default')
    await expect(resolveUsableDefaultAssignee(em, SCOPE, project, { now: NOW, graceDays: 3 })).resolves.toBeNull()
  })
})
