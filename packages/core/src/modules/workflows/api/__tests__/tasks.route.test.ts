/**
 * User Tasks list API tests.
 *
 * The inbox sends `myTasks=true` by default, so the narrowing the handler
 * applies for that flag is what makes the "My Tasks" view true: a caller must
 * see the tasks assigned to them personally plus the ones queued to a role they
 * hold, and nothing else.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { GET as listTasks } from '../tasks/route'
import { serializeUserTask } from '../tasks/serialize'
import { userTaskRowSchema } from '../openapi'
import { UserTask } from '../../data/entities'
import {
  makeTaskVisibilityRouteStubs,
  type TaskVisibilityRouteStubs,
} from './helpers/taskVisibilityRoute'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

type WhereClause = Record<string, unknown>

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const USER_ID = 'user-1'
const HIDDEN_TASK_ID = '11111111-2222-4333-8444-555555555555'

/**
 * Assigned to the caller and bound to an order they may not view: visible by
 * RELATIONSHIP, refused by the ENTITY clause. The row carries real content so a
 * leak would be detectable in the serialized body.
 */
function makeOrderBoundTask(): UserTask {
  const task = new UserTask()
  task.id = HIDDEN_TASK_ID
  task.workflowInstanceId = '11111111-2222-4333-8444-666666666666'
  task.stepInstanceId = '11111111-2222-4333-8444-777777777777'
  task.taskName = 'Approve the order'
  task.description = 'Approve the order'
  task.status = 'PENDING'
  task.assignedTo = USER_ID
  task.assigneeKind = 'user'
  task.assignedToRoles = null
  task.claimedBy = null
  task.entityBindings = [{ entityType: 'sales:sales_order', entityId: 'order-1' }]
  task.entityTypes = ['sales:sales_order']
  task.tenantId = TENANT_ID
  task.organizationId = ORG_ID
  task.createdAt = new Date('2026-07-28T09:00:00.000Z')
  task.updatedAt = new Date('2026-07-28T09:00:00.000Z')
  return task
}

describe('GET /api/workflows/tasks', () => {
  let mockEm: { findAndCount: jest.Mock; getConnection: () => { execute: jest.Mock } }
  let stubs: TaskVisibilityRouteStubs

  function setAuthRoles(roles: string[] | undefined) {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({
      sub: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      ...(roles ? { roles } : {}),
    })
  }

  /**
   * Rebuild the container with a different §6.4 posture. Every task read now
   * depends on who is asking, so the suite has to be able to say.
   */
  function withVisibility(options: Parameters<typeof makeTaskVisibilityRouteStubs>[0]) {
    stubs = makeTaskVisibilityRouteStubs(options)
    mockEm.getConnection = stubs.getConnection
    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return mockEm
        if (name === 'rbacService') return stubs.rbacService
        if (name === 'moduleConfigService') return stubs.moduleConfigService
        return null
      },
    })
  }

  async function runList(query: string): Promise<WhereClause> {
    await listTasks(new NextRequest(`http://localhost/api/workflows/tasks${query}`))
    return mockEm.findAndCount.mock.calls[0][1] as WhereClause
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockEm = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      getConnection: () => ({ execute: jest.fn() }),
    }

    // The suite's default caller is an administrator, so the pre-existing filter
    // assertions stay about the filters they were written for; the narrowing
    // itself gets its own describe block below.
    withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })

    setAuthRoles(['warehouse'])

    const {
      resolveOrganizationScopeForRequest,
    } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: ORG_ID })
  })

  test('scopes every listing to the caller tenant and organization', async () => {
    const where = await runList('')

    expect(mockEm.findAndCount).toHaveBeenCalledWith(UserTask, expect.any(Object), expect.any(Object))
    expect(where).toMatchObject({ tenantId: TENANT_ID, organizationId: { $in: [ORG_ID] } })
  })

  test('narrows to the caller as assignee or as a holder of the queued role when myTasks is set', async () => {
    const where = await runList('?myTasks=true')

    expect(where.$or).toEqual([
      { assignedTo: USER_ID },
      { assignedToRoles: { $overlap: ['warehouse'] } },
    ])
  })

  test('matches nothing by role for a caller holding no roles', async () => {
    setAuthRoles(undefined)

    const where = await runList('?myTasks=true')

    expect(where.$or).toEqual([{ assignedTo: USER_ID }, { assignedToRoles: { $overlap: [] } }])
  })

  test('leaves the listing unnarrowed when myTasks is absent', async () => {
    const where = await runList('?status=PENDING')

    expect(where.$or).toBeUndefined()
    expect(where.status).toBe('PENDING')
  })

  test('clamps an oversized limit to the documented maximum', async () => {
    await listTasks(new NextRequest('http://localhost/api/workflows/tasks?limit=5000'))

    expect(mockEm.findAndCount.mock.calls[0][2]).toMatchObject({ limit: 100, offset: 0 })
  })

  test('falls back to the default page size for unusable limits and offsets', async () => {
    await listTasks(new NextRequest('http://localhost/api/workflows/tasks?limit=abc&offset=-5'))

    expect(mockEm.findAndCount.mock.calls[0][2]).toMatchObject({ limit: 50, offset: 0 })
  })

  test('reports the clamped limit back in the pagination envelope', async () => {
    const response = await listTasks(new NextRequest('http://localhost/api/workflows/tasks?limit=5000'))
    const body = await response.json()

    expect(body.pagination).toEqual({ total: 0, limit: 100, offset: 0, hasMore: false })
  })

  test('serializes rows so the proposal link reaches the client', async () => {
    mockEm.findAndCount.mockResolvedValue([[makeTask({ formSchema: { proposalId: 'proposal-9' } })], 1])

    const response = await listTasks(new NextRequest('http://localhost/api/workflows/tasks'))
    const body = await response.json()

    expect(body.data[0].proposalId).toBe('proposal-9')
    expect(body.data[0].kind).toBe('user_task')
  })

  /**
   * §6.4 on the list route. `workflows.tasks.view` admits the caller to the
   * endpoint; the visibility rule decides which rows come back.
   */
  describe('the §6.4 read gate', () => {
    test('narrows an ordinary caller to their own work, their queues and viewable entities', async () => {
      withVisibility({
        acl: { features: ['workflows.tasks.view'] },
        scopedEntityTypes: ['sales:sales_order'],
      })

      const where = await runList('')

      expect(where.$and).toEqual([
        {
          $or: [
            { assignedTo: USER_ID, assigneeKind: 'user' },
            { claimedBy: USER_ID },
            { assignedToRoles: { $overlap: ['warehouse'] } },
          ],
        },
        // `sales:sales_order` requires `sales.orders.view`, which this caller
        // does not hold, so the whitelist is empty and only tasks about nothing
        // survive.
        { $or: [{ entityTypes: null }, { entityTypes: { $contained: [] } }] },
      ])
    })

    test('an administrator queries unnarrowed, and is TOLD what the entity gate refuses', async () => {
      // The gate is not weakened — the predicate still refuses the row, so it
      // never reaches `data`. It is moved out of the `WHERE` so the refusal can
      // be reported instead of leaving a page short by an unexplained row
      // (design §3.6).
      withVisibility({
        acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] },
        scopedEntityTypes: ['sales:sales_order'],
      })
      mockEm.findAndCount.mockResolvedValue([[makeOrderBoundTask()], 1])

      const response = await listTasks(new NextRequest('http://localhost/api/workflows/tasks'))
      const where = mockEm.findAndCount.mock.calls[0][1] as WhereClause
      const body = await response.json()

      expect(where.$and).toBeUndefined()
      expect(body.data).toEqual([])
      expect(body.diagnostics).toEqual({
        entityHidden: [
          { id: HIDDEN_TASK_ID, reason: 'denied:entity-access', entityType: 'sales:sales_order' },
        ],
        entityHiddenCount: 1,
      })
      // `total` counts it: an administrator asking "how much work is open?"
      // wants the true number, and the marker is what explains the short page.
      expect(body.pagination.total).toBe(1)
      // Nothing about the task itself crosses the wire.
      expect(JSON.stringify(body)).not.toContain('Approve the order')
    })

    test('an ordinary caller keeps the entity gate in SQL and is told nothing', async () => {
      withVisibility({
        acl: { features: ['workflows.tasks.view'] },
        scopedEntityTypes: ['sales:sales_order'],
      })

      const where = await runList('')
      const response = await listTasks(new NextRequest('http://localhost/api/workflows/tasks'))
      const body = await response.json()

      expect(where.$and).toContainEqual({
        $or: [{ entityTypes: null }, { entityTypes: { $contained: [] } }],
      })
      expect(body.diagnostics).toBeUndefined()
    })

    test('adds nothing at all for a superadmin', async () => {
      withVisibility({ acl: { isSuperAdmin: true }, scopedEntityTypes: ['sales:sales_order'] })

      expect((await runList('')).$and).toBeUndefined()
    })

    test('the tenant opt-out restores the legacy read filter, additively', async () => {
      withVisibility({
        acl: { features: ['workflows.tasks.view'] },
        scopedEntityTypes: ['sales:sales_order'],
        businessContextEnabled: false,
      })

      const where = await runList('')

      // Same rows as before the change: tenant + organization and nothing else.
      expect(where.$and).toBeUndefined()
      expect(where).toMatchObject({ tenantId: TENANT_ID, organizationId: { $in: [ORG_ID] } })
    })

    test('composes with the caller own filters instead of overwriting them', async () => {
      withVisibility({ acl: { features: ['workflows.tasks.view'] } })

      const where = await runList('?myTasks=true&status=PENDING')

      expect(where.status).toBe('PENDING')
      expect(where.$or).toBeDefined()
      expect(Array.isArray(where.$and)).toBe(true)
    })

    test('enumerates the bound entity types inside the caller scope', async () => {
      withVisibility({ acl: { features: ['workflows.tasks.view'] } })

      await runList('')

      const [sql, params] = stubs.execute.mock.calls[0] as [string, unknown[]]
      expect(sql).toContain('unnest(entity_types)')
      expect(params).toEqual([TENANT_ID, ORG_ID])
    })

    test('a legacy row with null columns still reaches its own assignee', async () => {
      withVisibility({ acl: { features: ['workflows.tasks.view'] } })
      const legacy = makeTask({
        assignedTo: USER_ID,
        assignedToRoles: null,
        entityBindings: null,
        entityTypes: null,
      })
      delete (legacy as Partial<UserTask>).assigneeKind
      mockEm.findAndCount.mockResolvedValue([[legacy], 1])

      const body = await (
        await listTasks(new NextRequest('http://localhost/api/workflows/tasks'))
      ).json()

      expect(body.data).toHaveLength(1)
      expect(body.pagination.total).toBe(1)
    })

    test('costs one ACL load for a whole page, not one per task', async () => {
      withVisibility({
        acl: { features: ['workflows.tasks.view'] },
        scopedEntityTypes: ['sales:sales_order', 'customers:customer_deal'],
      })
      mockEm.findAndCount.mockResolvedValue([
        Array.from({ length: 25 }, (_unused, index) =>
          makeTask({
            id: `11111111-2222-4333-8444-0000000000${String(index).padStart(2, '0')}`,
            assignedTo: USER_ID,
            entityBindings: [
              { entityType: 'sales:sales_order', entityId: `order-${index}` },
              { entityType: 'customers:customer_deal', entityId: `deal-${index}` },
            ],
          }),
        ),
        25,
      ])

      await listTasks(new NextRequest('http://localhost/api/workflows/tasks'))

      expect(stubs.rbacService.loadAcl).toHaveBeenCalledTimes(1)
      expect(stubs.execute).toHaveBeenCalledTimes(1)
      expect(stubs.moduleConfigService.getValue).toHaveBeenCalledTimes(1)
    })

    test('a page the SQL gate returned is reported whole, so total is not a lie', async () => {
      withVisibility({ acl: { features: ['workflows.tasks.view'] } })
      mockEm.findAndCount.mockResolvedValue([
        [makeTask({ assignedTo: USER_ID }), makeTask({ id: 'other', claimedBy: USER_ID })],
        2,
      ])

      const body = await (
        await listTasks(new NextRequest('http://localhost/api/workflows/tasks'))
      ).json()

      expect(body.data).toHaveLength(2)
      expect(body.pagination).toMatchObject({ total: 2, hasMore: false })
    })

    test('a row the SQL gate should never have returned is dropped rather than served', async () => {
      // Defense in depth: the `WHERE` is the same rule, so this cannot happen —
      // and if it ever does, losing a row is recoverable and leaking one is not.
      withVisibility({ acl: { features: ['workflows.tasks.view'] } })
      mockEm.findAndCount.mockResolvedValue([
        [makeTask({ assignedTo: 'somebody-else', assignedToRoles: null })],
        1,
      ])

      const body = await (
        await listTasks(new NextRequest('http://localhost/api/workflows/tasks'))
      ).json()

      expect(body.data).toEqual([])
    })

    test('a missing rbacService grants nothing rather than everything', async () => {
      // No ACL means no features, so the administrative arm cannot admit anyone.
      // Queue membership is deliberately unaffected — it is a relationship, not
      // a grant — so the row here belongs to nobody.
      const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
      createRequestContainer.mockResolvedValue({
        resolve: (name: string) => (name === 'em' ? mockEm : null),
      })
      mockEm.findAndCount.mockResolvedValue([
        [makeTask({ assignedTo: 'somebody-else', assignedToRoles: null })],
        1,
      ])

      const body = await (
        await listTasks(new NextRequest('http://localhost/api/workflows/tasks'))
      ).json()

      expect(body.data).toEqual([])
    })
  })
})

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const task = new UserTask()
  task.id = '11111111-2222-4333-8444-555555555555'
  task.workflowInstanceId = '11111111-2222-4333-8444-666666666666'
  task.stepInstanceId = '11111111-2222-4333-8444-777777777777'
  task.branchInstanceId = null
  task.taskName = 'Approve order'
  task.description = 'Approve the pending sales order'
  task.status = 'PENDING'
  task.formSchema = null
  task.formData = null
  task.assignedTo = null
  task.assignedToRoles = ['warehouse']
  task.claimedBy = null
  task.claimedAt = null
  task.dueDate = new Date('2026-08-01T10:00:00.000Z')
  task.escalatedAt = null
  task.escalatedTo = null
  task.completedBy = null
  task.completedAt = null
  task.comments = null
  task.tenantId = TENANT_ID
  task.organizationId = ORG_ID
  task.createdAt = new Date('2026-07-28T09:00:00.000Z')
  task.updatedAt = new Date('2026-07-28T09:30:00.000Z')
  Object.assign(task, overrides)
  return task
}

/**
 * Field names the raw-entity dump used to put on the wire. Every one of them
 * MUST survive the serializer — BACKWARD_COMPATIBILITY.md §7 allows adding
 * response fields, never removing one.
 */
function declaredUserTaskColumns(): string[] {
  const source = readFileSync(join(__dirname, '..', '..', 'data', 'entities.ts'), 'utf8')
  const classBody = source.split('export class UserTask {')[1]?.split('\n}')[0] ?? ''
  const names = classBody.match(/^\s{2}(\w+)[!?]?:/gm) ?? []
  return names.map((line) => line.trim().replace(/[!?]?:$/, ''))
}

describe('serializeUserTask', () => {
  test('keeps every field the raw entity dump already returned', () => {
    const serialized = serializeUserTask(makeTask())
    const columns = declaredUserTaskColumns()

    expect(columns).toContain('comments')
    expect(columns.length).toBeGreaterThan(20)
    for (const column of columns) {
      expect(Object.keys(serialized)).toContain(column)
    }
  })

  test('reports the assignee kind, defaulting a projection that lacks it', () => {
    expect(serializeUserTask(makeTask()).assigneeKind).toBe('user')
    expect(serializeUserTask(makeTask({ assigneeKind: 'customer' })).assigneeKind).toBe('customer')
    const legacy = makeTask()
    delete (legacy as Partial<UserTask>).assigneeKind
    expect(serializeUserTask(legacy).assigneeKind).toBe('user')
  })

  test('reports the stored entity types, deriving them for a row written before the column', () => {
    expect(
      serializeUserTask(makeTask({ entityTypes: ['customers:person'] })).entityTypes,
    ).toEqual(['customers:person'])

    // A pre-column row: NULL column, real bindings. The derived answer must
    // match what the SQL gate would have filtered on, or the two disagree.
    const legacy = makeTask({
      entityTypes: null,
      entityBindings: [
        { entityType: 'customers:person', entityId: 'a' },
        { entityType: 'customers:person', entityId: 'b' },
        { entityType: 'sales:sales_order', entityId: 'c' },
      ],
    })
    expect(serializeUserTask(legacy).entityTypes).toEqual([
      'customers:person',
      'sales:sales_order',
    ])
  })

  test('a task about nothing reports null entity types, never an empty array', () => {
    expect(serializeUserTask(makeTask()).entityTypes).toBeNull()
    expect(serializeUserTask(makeTask({ entityBindings: [] })).entityTypes).toBeNull()
  })

  test('emits dates in the same ISO form the entity dump produced', () => {
    const serialized = serializeUserTask(makeTask())

    expect(serialized.dueDate).toBe('2026-08-01T10:00:00.000Z')
    expect(serialized.createdAt).toBe('2026-07-28T09:00:00.000Z')
    expect(serialized.claimedAt).toBeNull()
  })

  test('lifts the work-item fields out of the authored form schema', () => {
    const serialized = serializeUserTask(
      makeTask({
        formSchema: {
          proposalId: 'proposal-1',
          priority: 'high',
          entityBindings: [{ entityType: 'sales:order', entityId: 'order-1' }],
        },
      }),
    )

    expect(serialized.proposalId).toBe('proposal-1')
    expect(serialized.priority).toBe('high')
    expect(serialized.entityBindings).toEqual([{ entityType: 'sales:order', entityId: 'order-1' }])
  })

  test('reports absent work-item fields as null rather than guessing', () => {
    const serialized = serializeUserTask(makeTask({ formSchema: { fields: [] } }))

    expect(serialized.proposalId).toBeNull()
    expect(serialized.priority).toBeNull()
    expect(serialized.entityBindings).toBeNull()
  })

  test('conforms to the published list-row schema', () => {
    expect(userTaskRowSchema.safeParse(serializeUserTask(makeTask())).success).toBe(true)
  })

  test('prefers the real columns over the authored form schema', () => {
    const serialized = serializeUserTask(
      makeTask({
        priority: 'extreme',
        entityBindings: [{ entityType: 'customers:person', entityId: 'person-1' }],
        formSchema: {
          priority: 'low',
          entityBindings: [{ entityType: 'sales:order', entityId: 'order-1' }],
        },
      }),
    )

    expect(serialized.priority).toBe('extreme')
    expect(serialized.entityBindings).toEqual([{ entityType: 'customers:person', entityId: 'person-1' }])
  })

  test('still falls back to the form schema for rows written before the columns existed', () => {
    const serialized = serializeUserTask(
      makeTask({
        priority: null,
        entityBindings: null,
        formSchema: {
          priority: 'high',
          entityBindings: [{ entityType: 'sales:order', entityId: 'order-1' }],
        },
      }),
    )

    expect(serialized.priority).toBe('high')
    expect(serialized.entityBindings).toEqual([{ entityType: 'sales:order', entityId: 'order-1' }])
  })

  test('an existing row with null columns and no form schema serializes as before', () => {
    const serialized = serializeUserTask(makeTask())

    expect(serialized.priority).toBeNull()
    expect(serialized.entityBindings).toBeNull()
    expect(serialized.reassignedBy).toBeNull()
    expect(serialized.reassignedAt).toBeNull()
    expect(serialized.reassignReason).toBeNull()
  })

  test('exposes the reassignment audit and the optimistic-lock version', () => {
    const serialized = serializeUserTask(
      makeTask({
        reassignedBy: 'supervisor-1',
        reassignedAt: new Date('2026-07-28T11:00:00.000Z'),
        reassignReason: 'Owner on leave',
      }),
    )

    expect(serialized.reassignedBy).toBe('supervisor-1')
    expect(serialized.reassignedAt).toBe('2026-07-28T11:00:00.000Z')
    expect(serialized.reassignReason).toBe('Owner on leave')
    expect(serialized.updatedAt).toBe('2026-07-28T09:30:00.000Z')
  })
})

/**
 * The migration and the entity must not drift: an entity column with no
 * matching snapshot column means the schema the app expects is not the schema
 * `yarn db:migrate` would produce.
 */
describe('user_tasks schema', () => {
  const snapshot = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'migrations', '.snapshot-open-mercato.json'), 'utf8'),
  ) as { tables: Array<{ name: string; columns: Record<string, { nullable: boolean; default: unknown }> }> }

  const userTasks = snapshot.tables.find((table) => table.name === 'user_tasks')

  test('the snapshot carries the new columns, all nullable (BC §8 additive-only)', () => {
    expect(userTasks).toBeDefined()
    for (const column of ['entity_bindings', 'priority', 'reassigned_by', 'reassigned_at', 'reassign_reason']) {
      expect(userTasks?.columns[column]).toBeDefined()
      expect(userTasks?.columns[column]?.nullable).toBe(true)
    }
  })

  test('every declared entity property maps to a snapshot column', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'data', 'entities.ts'), 'utf8')
    const classBody = source.split('export class UserTask {')[1]?.split('\n}')[0] ?? ''
    const columnNames = [...classBody.matchAll(/@Property\(\{\s*name: '([^']+)'/g)].map((match) => match[1])

    expect(columnNames.length).toBeGreaterThan(20)
    for (const column of columnNames) {
      expect(Object.keys(userTasks?.columns ?? {})).toContain(column)
    }
  })
})
