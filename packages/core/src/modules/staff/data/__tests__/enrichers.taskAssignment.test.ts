/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enrichers } from '../enrichers'
import { StaffTimeProjectMember, StaffTimeTask, StaffTimeTaskStatus } from '../entities'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const USER_ID = 'user-1'
const SELF_ID = 'member-self'
const OTHER_ID = 'member-other'
const PROJECT_ID = 'project-1'
const OTHER_PROJECT_ID = 'project-2'
const OPEN_STATUS_ID = 'status-open'
const DONE_STATUS_ID = 'status-done'

const assignmentEnricher = enrichers.find((enricher) => enricher.id === 'staff.timesheets-tasks-assignment')!

type World = Map<unknown, Array<Record<string, unknown>>>

function context(world: World): EnricherContext {
  const em = {
    fork: () => em,
    find: async (cls: unknown, where: Record<string, unknown>) => {
      const rows = world.get(cls) ?? []
      if (cls !== StaffTimeProjectMember) return rows
      return rows.filter(
        (row) =>
          row.staffMemberId === where.staffMemberId &&
          row.isAssigner === true &&
          row.status === 'active' &&
          !row.deletedAt,
      )
    },
  }
  return {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    em,
    container: { resolve: () => undefined },
  } as unknown as EnricherContext
}

function task(id: string, overrides: Record<string, unknown> = {}) {
  return { id, timeProjectId: PROJECT_ID, taskStatusId: OPEN_STATUS_ID, assigneeStaffMemberId: null, ...overrides }
}

describe('staff.timesheets-tasks-assignment enricher', () => {
  const world: World = new Map<unknown, Array<Record<string, unknown>>>([
    [
      StaffTimeTask,
      [
        task('claimable'),
        task('taken', { assigneeStaffMemberId: OTHER_ID }),
        task('mine', { assigneeStaffMemberId: SELF_ID }),
        task('done', { taskStatusId: DONE_STATUS_ID }),
        task('elsewhere', { timeProjectId: OTHER_PROJECT_ID }),
      ],
    ],
    [
      StaffTimeTaskStatus,
      [
        { id: OPEN_STATUS_ID, isDone: false },
        { id: DONE_STATUS_ID, isDone: true },
      ],
    ],
    [
      StaffTimeProjectMember,
      [
        { timeProjectId: PROJECT_ID, staffMemberId: SELF_ID, isAssigner: true, status: 'active', deletedAt: null },
        {
          timeProjectId: OTHER_PROJECT_ID,
          staffMemberId: SELF_ID,
          isAssigner: true,
          status: 'active',
          deletedAt: null,
          assignedEndDate: '2020-01-01',
        },
      ],
    ],
  ])

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({ id: SELF_ID })
  })

  it('is gated on the tasks view feature and never served from the list cache', () => {
    expect(assignmentEnricher.features).toEqual(['staff.timesheets.tasks.view'])
    expect(assignmentEnricher.cacheableOnListHit).toBe(false)
  })

  it('lets an active assigner claim only an unassigned task in an open column', async () => {
    const rows = await assignmentEnricher.enrichMany!(
      ['claimable', 'taken', 'mine', 'done', 'elsewhere'].map((id) => ({ id })),
      context(world),
    )
    const byId = new Map(rows.map((row) => [row.id, row._staffAssignment]))

    expect(byId.get('claimable')).toEqual({ canClaim: true, canRelease: false })
    expect(byId.get('taken')).toEqual({ canClaim: false, canRelease: false })
    expect(byId.get('mine')).toEqual({ canClaim: false, canRelease: true })
    expect(byId.get('done')).toEqual({ canClaim: false, canRelease: false })
    expect(byId.get('elsewhere')).toEqual({ canClaim: false, canRelease: false })
  })

  it('offers nothing to a caller without a staff profile', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const [row] = await assignmentEnricher.enrichMany!([{ id: 'claimable' }], context(world))

    expect(row._staffAssignment).toEqual({ canClaim: false, canRelease: false })
  })
})
