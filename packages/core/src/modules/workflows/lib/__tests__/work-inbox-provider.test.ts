/**
 * Work Inbox — provider contract, registry, ordering and the core source.
 *
 * The two properties that carry the whole feature are pinned here: the merged
 * queue is the same list with one source as with two (so the OSS inbox is not a
 * degraded special case), and a source that is simply absent — the enterprise
 * `agent_disposition` provider on an install without enterprise — costs nothing
 * and raises nothing (spec §2.3: "Without enterprise, the inbox simply shows
 * workflow tasks").
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import {
  clearWorkInboxSources,
  compareWorkInboxRows,
  deriveWorkInboxOverdue,
  getWorkInboxSources,
  normalizeWorkInboxPriority,
  registerWorkInboxSources,
  selectWorkInboxSources,
  sortWorkInboxRows,
} from '../work-inbox/provider'
import type {
  WorkInboxQuery,
  WorkInboxRow,
  WorkInboxScope,
  WorkInboxSourceContext,
  WorkInboxSourceProvider,
} from '../work-inbox/provider'
import {
  buildUserTaskWorkInboxWhere,
  toUserTaskWorkInboxRow,
  userTaskWorkInboxSource,
} from '../work-inbox/user-task-source'
import { listClaimableWorkInbox, listWorkInbox } from '../work-inbox/service'
import { UserTask } from '../../data/entities'
import { makeTaskVisibilityContext } from './helpers/taskVisibilityContext'

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const USER_ID = '11111111-2222-4333-8444-cccccccccccc'
const NOW = new Date('2026-07-28T12:00:00.000Z')

/**
 * An administrator for these fixtures: `workflows.tasks.view_all` means the
 * §6.4 clause contributes nothing, so the assertions below stay about the
 * filters they are testing. The narrowing itself is covered in
 * `task-visibility-request.test.ts` and in the route suites.
 */
const scope: WorkInboxScope = {
  tenantId: TENANT_ID,
  organizationIds: [ORG_ID],
  userId: USER_ID,
  roles: ['approver'],
  visibility: makeTaskVisibilityContext({
    userId: USER_ID,
    tenantId: TENANT_ID,
    organizationIds: [ORG_ID],
    roleNames: ['approver'],
    grantedFeatures: ['workflows.tasks.view', 'workflows.tasks.view_all'],
  }),
}

function makeQuery(overrides: Partial<WorkInboxQuery> = {}): WorkInboxQuery {
  return {
    kinds: null,
    moduleIds: null,
    entityTypes: null,
    roles: null,
    priorities: null,
    statuses: null,
    overdueOnly: false,
    myWork: false,
    assignedTo: null,
    workflowInstanceId: null,
    limit: 50,
    offset: 0,
    now: NOW,
    ...overrides,
  }
}

function makeRow(overrides: Partial<WorkInboxRow> = {}): WorkInboxRow {
  return {
    id: 'row-1',
    kind: 'user_task',
    moduleId: 'workflows',
    title: 'Approve order',
    description: null,
    status: 'PENDING',
    priority: null,
    dueDate: null,
    overdue: false,
    createdAt: '2026-07-28T09:00:00.000Z',
    updatedAt: '2026-07-28T09:00:00.000Z',
    assignedTo: null,
    assignedToRoles: null,
    claimedBy: null,
    entityTypes: [],
    entityBindings: [],
    detailHref: null,
    actions: [],
    details: {},
    ...overrides,
  }
}

function makeStubSource(
  kind: string,
  moduleId: string,
  rows: WorkInboxRow[],
): WorkInboxSourceProvider {
  return {
    kind,
    moduleId,
    list: async () => ({ rows, total: rows.length }),
  }
}

function makeContext(em: unknown): WorkInboxSourceContext {
  return {
    scope,
    resolve: <T,>(name: string): T => {
      if (name !== 'em') throw new Error(`[internal] unexpected resolve(${name})`)
      return em as T
    },
  }
}

describe('work inbox source registry', () => {
  beforeEach(() => clearWorkInboxSources())

  test('registers the core source alone when no other module contributes', () => {
    registerWorkInboxSources([{ moduleId: 'workflows', sources: [userTaskWorkInboxSource] }])

    expect(getWorkInboxSources().map((entry) => entry.provider.kind)).toEqual(['user_task'])
  })

  test('a second module adds to the set regardless of registration order', () => {
    const disposition = makeStubSource('agent_disposition', 'agent_orchestrator', [])

    registerWorkInboxSources([{ moduleId: 'agent_orchestrator', sources: [disposition] }])
    registerWorkInboxSources([{ moduleId: 'workflows', sources: [userTaskWorkInboxSource] }])

    expect(getWorkInboxSources().map((entry) => entry.provider.kind).sort()).toEqual([
      'agent_disposition',
      'user_task',
    ])
  })

  test('re-registering a module replaces only its own sources', () => {
    registerWorkInboxSources([{ moduleId: 'workflows', sources: [userTaskWorkInboxSource] }])
    registerWorkInboxSources([
      { moduleId: 'agent_orchestrator', sources: [makeStubSource('agent_disposition', 'agent_orchestrator', [])] },
    ])
    registerWorkInboxSources([{ moduleId: 'workflows', sources: [userTaskWorkInboxSource] }])

    expect(getWorkInboxSources()).toHaveLength(2)
  })

  test('narrows to the requested kinds and modules', () => {
    registerWorkInboxSources([{ moduleId: 'workflows', sources: [userTaskWorkInboxSource] }])
    registerWorkInboxSources([
      { moduleId: 'agent_orchestrator', sources: [makeStubSource('agent_disposition', 'agent_orchestrator', [])] },
    ])

    expect(selectWorkInboxSources(makeQuery({ kinds: ['user_task'] }))).toHaveLength(1)
    expect(selectWorkInboxSources(makeQuery({ moduleIds: ['agent_orchestrator'] }))).toHaveLength(1)
    expect(selectWorkInboxSources(makeQuery({ kinds: ['nothing_registered'] }))).toHaveLength(0)
  })
})

describe('work inbox ordering', () => {
  test('sorts by priority, then nearest due date, then oldest first', () => {
    const rows = [
      makeRow({ id: 'd', priority: 'low', createdAt: '2026-07-01T00:00:00.000Z' }),
      makeRow({ id: 'b', priority: 'extreme', dueDate: '2026-08-02T00:00:00.000Z' }),
      makeRow({ id: 'a', priority: 'extreme', dueDate: '2026-08-01T00:00:00.000Z' }),
      makeRow({ id: 'c', priority: 'high', createdAt: '2026-06-01T00:00:00.000Z' }),
    ]

    expect(sortWorkInboxRows(rows).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('a due date only breaks ties inside the same priority', () => {
    const urgentNoDeadline = makeRow({ id: 'urgent', priority: 'extreme' })
    const routineDueToday = makeRow({ id: 'routine', priority: 'medium', dueDate: '2026-07-28T13:00:00.000Z' })

    expect(compareWorkInboxRows(urgentNoDeadline, routineDueToday)).toBeLessThan(0)
  })

  test('unprioritized work sorts with medium rather than last', () => {
    const rows = [
      makeRow({ id: 'low', priority: 'low' }),
      makeRow({ id: 'unset', priority: null }),
      makeRow({ id: 'high', priority: 'high' }),
    ]

    expect(sortWorkInboxRows(rows).map((row) => row.id)).toEqual(['high', 'unset', 'low'])
  })

  test('items with no due date sort after dated ones of the same priority', () => {
    const rows = [
      makeRow({ id: 'undated', priority: 'high' }),
      makeRow({ id: 'dated', priority: 'high', dueDate: '2026-09-01T00:00:00.000Z' }),
    ]

    expect(sortWorkInboxRows(rows).map((row) => row.id)).toEqual(['dated', 'undated'])
  })

  test('does not mutate the input array', () => {
    const rows = [makeRow({ id: 'b', priority: 'low' }), makeRow({ id: 'a', priority: 'high' })]

    sortWorkInboxRows(rows)

    expect(rows.map((row) => row.id)).toEqual(['b', 'a'])
  })
})

describe('overdue derivation', () => {
  test('an open item past its due date is overdue', () => {
    expect(deriveWorkInboxOverdue('2026-07-28T11:59:00.000Z', 'PENDING', NOW)).toBe(true)
    expect(deriveWorkInboxOverdue('2026-07-28T11:59:00.000Z', 'IN_PROGRESS', NOW)).toBe(true)
    expect(deriveWorkInboxOverdue('2026-07-28T11:59:00.000Z', 'ESCALATED', NOW)).toBe(true)
  })

  test('a finished item is never overdue however late it closed', () => {
    expect(deriveWorkInboxOverdue('2026-07-28T11:59:00.000Z', 'COMPLETED', NOW)).toBe(false)
    expect(deriveWorkInboxOverdue('2026-07-28T11:59:00.000Z', 'CANCELLED', NOW)).toBe(false)
  })

  test('no due date and unparseable dates are never overdue', () => {
    expect(deriveWorkInboxOverdue(null, 'PENDING', NOW)).toBe(false)
    expect(deriveWorkInboxOverdue('not-a-date', 'PENDING', NOW)).toBe(false)
  })

  test('normalizes only the authored priority vocabulary', () => {
    expect(normalizeWorkInboxPriority('HIGH')).toBe('high')
    expect(normalizeWorkInboxPriority('urgent')).toBeNull()
    expect(normalizeWorkInboxPriority(3)).toBeNull()
  })
})

describe('user_task source query', () => {
  test('scopes every listing to the caller tenant and organizations', () => {
    const where = buildUserTaskWorkInboxWhere(makeQuery(), scope) as Record<string, unknown>

    expect(where).toMatchObject({ tenantId: TENANT_ID, organizationId: { $in: [ORG_ID] } })
  })

  test('omits the organization predicate only for the wildcard scope', () => {
    const where = buildUserTaskWorkInboxWhere(makeQuery(), {
      ...scope,
      organizationIds: null,
    }) as Record<string, unknown>

    expect(where).not.toHaveProperty('organizationId')
    expect(where).toMatchObject({ tenantId: TENANT_ID })
  })

  test('myWork matches the caller as assignee, claimant or role holder', () => {
    const where = buildUserTaskWorkInboxWhere(makeQuery({ myWork: true }), scope) as Record<string, unknown>

    expect(where.$and).toContainEqual({
      $or: [
        { assignedTo: USER_ID },
        { claimedBy: USER_ID },
        { assignedToRoles: { $overlap: ['approver'] } },
      ],
    })
  })

  test('filters by bound entity type through a jsonb containment predicate', () => {
    const where = buildUserTaskWorkInboxWhere(
      makeQuery({ entityTypes: ['sales:order', 'customers:person'] }),
      scope,
    ) as Record<string, unknown>

    expect(where.$and).toContainEqual({
      $or: [
        { entityBindings: { $contains: [{ entityType: 'sales:order' }] } },
        { entityBindings: { $contains: [{ entityType: 'customers:person' }] } },
      ],
    })
  })

  test('overdue narrows to a past due date on a non-terminal item', () => {
    const where = buildUserTaskWorkInboxWhere(makeQuery({ overdueOnly: true }), scope) as Record<string, unknown>

    expect(where.$and).toContainEqual({ dueDate: { $lt: NOW } })
    expect(where.$and).toContainEqual({ status: { $nin: ['COMPLETED', 'CANCELLED'] } })
  })

  test('carries kind, module, role and priority filters into the query', () => {
    const where = buildUserTaskWorkInboxWhere(
      makeQuery({ roles: ['warehouse'], priorities: ['high'], statuses: ['PENDING'], workflowInstanceId: 'wf-1' }),
      scope,
    ) as Record<string, unknown>

    expect(where.$and).toContainEqual({ assignedToRoles: { $overlap: ['warehouse'] } })
    expect(where.$and).toContainEqual({ priority: { $in: ['high'] } })
    expect(where.$and).toContainEqual({ status: { $in: ['PENDING'] } })
    expect(where.$and).toContainEqual({ workflowInstanceId: 'wf-1' })
  })

  test('an unfiltered administrator query carries no extra predicates', () => {
    const where = buildUserTaskWorkInboxWhere(makeQuery(), scope) as Record<string, unknown>

    // `view_all` drops the RELATIONSHIP clause, and the ENTITY clause moves out
    // of the `WHERE` for this caller so the refused rows can be REPORTED rather
    // than silently missing (design §3.6). The gate itself is not weakened —
    // `partitionTaskPage` still refuses every one of those rows before they can
    // reach a response. Tenant/organization scoping below is untouched.
    expect(where.$and).toBeUndefined()
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.organizationId).toEqual({ $in: [ORG_ID] })
  })

  test('an ordinary caller still gets the entity gate in SQL', () => {
    const where = buildUserTaskWorkInboxWhere(makeQuery(), {
      ...scope,
      visibility: makeTaskVisibilityContext({
        userId: USER_ID,
        tenantId: TENANT_ID,
        organizationIds: [ORG_ID],
        roleNames: ['approver'],
        grantedFeatures: ['workflows.tasks.view'],
      }),
    }) as Record<string, unknown>

    expect(where.$and).toContainEqual({
      $or: [{ entityTypes: null }, { entityTypes: { $contained: [] } }],
    })
  })

  test('a superadmin carries no extra predicates at all', () => {
    const where = buildUserTaskWorkInboxWhere(makeQuery(), {
      ...scope,
      visibility: makeTaskVisibilityContext({ isSuperAdmin: true }),
    }) as Record<string, unknown>

    expect(where.$and).toBeUndefined()
  })
})

describe('user_task row projection', () => {
  test('keeps the serialized task as a superset under details', () => {
    const row = toUserTaskWorkInboxRow(makeTask({ formSchema: { proposalId: 'proposal-9' } }), NOW)

    expect(row.kind).toBe('user_task')
    expect(row.moduleId).toBe('workflows')
    expect(row.details.proposalId).toBe('proposal-9')
    expect(row.details.taskName).toBe('Approve order')
    expect(row.detailHref).toBe('/backend/tasks/11111111-2222-4333-8444-555555555555')
  })

  test('derives overdue and lifts the bound entity types', () => {
    const row = toUserTaskWorkInboxRow(
      makeTask({
        dueDate: new Date('2026-07-27T00:00:00.000Z'),
        priority: 'high',
        entityBindings: [
          { entityType: 'sales:order', entityId: 'order-1', label: 'SO-1' },
          { entityType: 'sales:order', entityId: 'order-2' },
        ],
      }),
      NOW,
    )

    expect(row.overdue).toBe(true)
    expect(row.priority).toBe('high')
    expect(row.entityTypes).toEqual(['sales:order'])
    expect(row.entityBindings).toHaveLength(2)
  })

  test('ignores malformed bindings instead of surfacing them', () => {
    const row = toUserTaskWorkInboxRow(
      makeTask({ entityBindings: [{ entityType: 'sales:order' }, 'nonsense', null] }),
      NOW,
    )

    expect(row.entityBindings).toEqual([])
    expect(row.entityTypes).toEqual([])
  })

  test('asks the database for one page worth of candidates, scoped', async () => {
    const findAndCount = jest.fn(async () => [[makeTask()], 1] as [UserTask[], number])
    const em = { findAndCount } as unknown as EntityManager

    const result = await userTaskWorkInboxSource.list(makeQuery({ limit: 20, offset: 40 }), makeContext(em))

    expect(findAndCount).toHaveBeenCalledWith(
      UserTask,
      expect.objectContaining({ tenantId: TENANT_ID }),
      expect.objectContaining({ limit: 60, offset: 0 }),
    )
    expect(result.total).toBe(1)
    expect(result.rows[0]?.kind).toBe('user_task')
  })
})

describe('work inbox merge service', () => {
  beforeEach(() => clearWorkInboxSources())

  const context = makeContext({})

  test('returns just the workflow tasks when no other source is registered', async () => {
    registerWorkInboxSources([
      { moduleId: 'workflows', sources: [makeStubSource('user_task', 'workflows', [makeRow({ id: 'task-1' })])] },
    ])

    const result = await listWorkInbox(makeQuery(), context)

    expect(result.rows.map((row) => row.id)).toEqual(['task-1'])
    expect(result.kinds).toEqual(['user_task'])
    expect(result.degradedKinds).toEqual([])
  })

  test('interleaves a second source by priority rather than appending it', async () => {
    registerWorkInboxSources([
      {
        moduleId: 'workflows',
        sources: [
          makeStubSource('user_task', 'workflows', [
            makeRow({ id: 'task-low', priority: 'low' }),
            makeRow({ id: 'task-high', priority: 'high' }),
          ]),
        ],
      },
    ])
    registerWorkInboxSources([
      {
        moduleId: 'agent_orchestrator',
        sources: [
          makeStubSource('agent_disposition', 'agent_orchestrator', [
            makeRow({ id: 'disposition', kind: 'agent_disposition', priority: 'extreme' }),
          ]),
        ],
      },
    ])

    const result = await listWorkInbox(makeQuery(), context)

    expect(result.rows.map((row) => row.id)).toEqual(['disposition', 'task-high', 'task-low'])
    expect(result.total).toBe(3)
  })

  test('pages over the merged and ordered window', async () => {
    registerWorkInboxSources([
      {
        moduleId: 'workflows',
        sources: [
          makeStubSource('user_task', 'workflows', [
            makeRow({ id: 'a', priority: 'extreme' }),
            makeRow({ id: 'b', priority: 'high' }),
            makeRow({ id: 'c', priority: 'low' }),
          ]),
        ],
      },
    ])

    const result = await listWorkInbox(makeQuery({ limit: 1, offset: 1 }), context)

    expect(result.rows.map((row) => row.id)).toEqual(['b'])
    expect(result.total).toBe(3)
  })

  test('one failing source degrades that kind instead of emptying the inbox', async () => {
    registerWorkInboxSources([
      { moduleId: 'workflows', sources: [makeStubSource('user_task', 'workflows', [makeRow({ id: 'task-1' })])] },
    ])
    registerWorkInboxSources([
      {
        moduleId: 'agent_orchestrator',
        sources: [
          {
            kind: 'agent_disposition',
            moduleId: 'agent_orchestrator',
            list: async () => {
              throw new Error('[internal] disposition service unavailable')
            },
          },
        ],
      },
    ])

    const result = await listWorkInbox(makeQuery(), context)

    expect(result.rows.map((row) => row.id)).toEqual(['task-1'])
    expect(result.degradedKinds).toEqual(['agent_disposition'])
  })

  test('claim-next candidates are the unassigned role-queued items, in inbox order', async () => {
    registerWorkInboxSources([
      {
        moduleId: 'workflows',
        sources: [
          makeStubSource('user_task', 'workflows', [
            makeRow({ id: 'mine', status: 'PENDING', assignedTo: USER_ID, assignedToRoles: ['approver'] }),
            makeRow({ id: 'claimed', status: 'IN_PROGRESS', claimedBy: USER_ID, assignedToRoles: ['approver'] }),
            makeRow({ id: 'queued-low', status: 'PENDING', priority: 'low', assignedToRoles: ['approver'] }),
            makeRow({ id: 'queued-high', status: 'PENDING', priority: 'high', assignedToRoles: ['approver'] }),
            makeRow({ id: 'unassignable', status: 'PENDING', assignedToRoles: [] }),
          ]),
        ],
      },
    ])

    const candidates = await listClaimableWorkInbox(makeQuery(), context)

    expect(candidates.map((row) => row.id)).toEqual(['queued-high', 'queued-low'])
  })
})

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const task = new UserTask()
  task.id = '11111111-2222-4333-8444-555555555555'
  task.workflowInstanceId = '11111111-2222-4333-8444-666666666666'
  task.stepInstanceId = '11111111-2222-4333-8444-777777777777'
  task.branchInstanceId = null
  task.taskName = 'Approve order'
  task.description = null
  task.status = 'PENDING'
  task.formSchema = null
  task.formData = null
  task.assignedTo = null
  task.assignedToRoles = ['approver']
  task.claimedBy = null
  task.claimedAt = null
  task.dueDate = null
  task.escalatedAt = null
  task.escalatedTo = null
  task.completedBy = null
  task.completedAt = null
  task.comments = null
  task.entityBindings = null
  task.priority = null
  task.reassignedBy = null
  task.reassignedAt = null
  task.reassignReason = null
  task.tenantId = TENANT_ID
  task.organizationId = ORG_ID
  task.createdAt = new Date('2026-07-28T09:00:00.000Z')
  task.updatedAt = new Date('2026-07-28T09:30:00.000Z')
  Object.assign(task, overrides)
  return task
}
