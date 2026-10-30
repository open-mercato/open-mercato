/**
 * User Task detail API — the §6.4 read gate and the 404-vs-403 disclosure rule.
 *
 * The property under test is negative and easy to lose: a task the caller may
 * not see must be indistinguishable from one that does not exist. A different
 * status, a different body, even a different error string, is a way to probe
 * another tenant's task ids one uuid at a time.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { NextRequest } from 'next/server'
import { GET as getTask } from '../tasks/[id]/route'
import { UserTask } from '../../data/entities'
import { makeTaskVisibilityRouteStubs, type TaskVisibilityRouteStubs } from './helpers/taskVisibilityRoute'
import { userTaskDetailResponseSchema } from '../openapi'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('../../lib/task-decision-context', () => ({
  loadTaskDecisionContext: jest.fn(async () => ({ decisions: [], stepId: 'step-1', formKey: null })),
}))

// Classification is exercised in `lib/__tests__/task-entity-access.test.ts`;
// here it is pinned so the assertions stay about the disclosure policy. An
// access-restricted custom entity is the interesting case: it resolves fine and
// the caller simply may not view it, which is `denied:entity-access` rather than
// the authored-typo `denied:unknown-entity-type`.
jest.mock('@open-mercato/core/modules/entities/lib/entityClassification', () => ({
  classifyRecordsEntity: jest.fn(async () => ({ kind: 'custom', restricted: true })),
}))

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const USER_ID = 'user-1'
const TASK_ID = '11111111-2222-4333-8444-555555555555'

type MockEm = { findOne: jest.Mock; getConnection: () => { execute: jest.Mock } }

let mockEm: MockEm
let stubs: TaskVisibilityRouteStubs
let taskRow: UserTask | null

/** Only `UserTask` lookups resolve — anything else the request makes is its own. */
function setTask(task: UserTask | null) {
  taskRow = task
}

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const task = new UserTask()
  task.id = TASK_ID
  task.workflowInstanceId = '11111111-2222-4333-8444-666666666666'
  task.stepInstanceId = '11111111-2222-4333-8444-777777777777'
  task.taskName = 'Approve order'
  task.status = 'PENDING'
  task.assignedTo = USER_ID
  task.assigneeKind = 'user'
  task.assignedToRoles = null
  task.claimedBy = null
  task.entityBindings = null
  task.entityTypes = null
  task.tenantId = TENANT_ID
  task.organizationId = ORG_ID
  task.createdAt = new Date('2026-07-28T09:00:00.000Z')
  task.updatedAt = new Date('2026-07-28T09:00:00.000Z')
  Object.assign(task, overrides)
  return task
}

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

function runDetail(id = TASK_ID) {
  return getTask(new NextRequest(`http://localhost/api/workflows/tasks/${id}`), { params: { id } })
}

beforeEach(() => {
  jest.clearAllMocks()

  taskRow = null
  mockEm = {
    findOne: jest.fn(async (entity: unknown) => (entity === UserTask ? taskRow : null)),
    getConnection: () => ({ execute: jest.fn() }),
  }
  withVisibility({ acl: { features: ['workflows.tasks.view'] } })

  const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
  getAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    roles: ['warehouse'],
  })

  const {
    resolveOrganizationScopeForRequest,
  } = require('@open-mercato/core/modules/directory/utils/organizationScope')
  resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: ORG_ID })
})

describe('GET /api/workflows/tasks/[id]', () => {
  test('scopes the lookup to the caller tenant and organizations', async () => {
    await runDetail()

    expect(mockEm.findOne).toHaveBeenCalledWith(UserTask, {
      id: TASK_ID,
      tenantId: TENANT_ID,
      organizationId: { $in: [ORG_ID] },
    })
  })

  test('serves the assignee their own task', async () => {
    setTask(makeTask())

    const response = await runDetail()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.id).toBe(TASK_ID)
  })

  test('serves a legacy row whose entity columns are null', async () => {
    const legacy = makeTask({ entityBindings: null, entityTypes: null })
    delete (legacy as Partial<UserTask>).assigneeKind
    setTask(legacy)

    expect((await runDetail()).status).toBe(200)
  })

  test('serves a role-queue member the queue own task', async () => {
    setTask(
      makeTask({ assignedTo: null, assignedToRoles: ['warehouse'] }),
    )

    expect((await runDetail()).status).toBe(200)
  })
})

describe('GET /api/workflows/tasks/[id] — disclosure', () => {
  async function bodyAndStatus(response: Response) {
    return { status: response.status, body: await response.json() }
  }

  test('an unrelated colleague gets exactly the missing-task answer', async () => {
    setTask(makeTask({ assignedTo: 'somebody-else' }))
    const refused = await bodyAndStatus(await runDetail())

    setTask(null)
    const missing = await bodyAndStatus(await runDetail('11111111-2222-4333-8444-999999999999'))

    expect(refused).toEqual(missing)
    expect(refused).toEqual({ status: 404, body: { error: 'Task not found' } })
  })

  test('a foreign-tenant id is the same answer again — the lookup never sees it', async () => {
    // The `findOne` filter carries the tenant, so a cross-tenant id resolves to
    // nothing before the predicate is ever consulted.
    setTask(null)

    expect(await bodyAndStatus(await runDetail())).toEqual({
      status: 404,
      body: { error: 'Task not found' },
    })
  })

  test('an entity refusal is a bare 404 for a caller who is merely assigned', async () => {
    withVisibility({
      acl: { features: ['workflows.tasks.view'] },
      scopedEntityTypes: ['sales:sales_order'],
    })
    setTask(
      makeTask({
        entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
        entityTypes: ['sales:sales_order'],
      }),
    )

    expect(await bodyAndStatus(await runDetail())).toEqual({
      status: 404,
      body: { error: 'Task not found' },
    })
  })

  test('a view_all holder gets the diagnosis instead, naming the blocking type', async () => {
    withVisibility({
      acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] },
      scopedEntityTypes: ['sales:sales_order'],
    })
    setTask(
      makeTask({
        assignedTo: 'somebody-else',
        entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
        entityTypes: ['sales:sales_order'],
      }),
    )

    const { status, body } = await bodyAndStatus(await runDetail())

    expect(status).toBe(403)
    expect(body).toEqual({
      error: 'Forbidden',
      reason: 'denied:entity-access',
      entityType: 'sales:sales_order',
    })
  })

  test('a view_all holder sees a colleague task they have no entity problem with', async () => {
    withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })
    setTask(makeTask({ assignedTo: 'somebody-else' }))

    expect((await runDetail()).status).toBe(200)
  })

  test('the tenant opt-out restores the legacy read, and only the read', async () => {
    withVisibility({
      acl: { features: ['workflows.tasks.view'] },
      businessContextEnabled: false,
    })
    setTask(makeTask({ assignedTo: 'somebody-else' }))

    expect((await runDetail()).status).toBe(200)
  })

  test('costs one ACL load for the request', async () => {
    setTask(makeTask())

    await runDetail()

    expect(stubs.rbacService.loadAcl).toHaveBeenCalledTimes(1)
  })

  test('resolves entity access from the task own bindings, not a table scan', async () => {
    setTask(
      makeTask({ entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }] }),
    )

    await runDetail()

    // The single-task path never enumerates the tenant's types — it asks only
    // about the bindings the row in hand carries.
    expect(stubs.execute).not.toHaveBeenCalled()
  })
})

/**
 * The act surfaces the response advertises (§6.4, "administration widens seeing,
 * never acting").
 *
 * The server has always computed this answer and used to throw it away, which is
 * how the backoffice task page came to render a Complete button that answers 409
 * for a `workflows.tasks.view_all` administrator. The property under test is
 * that the DECISION travels: a page that has to guess is a second copy of the
 * rule, and the two drift.
 */
describe('GET /api/workflows/tasks/[id] — act surfaces', () => {
  async function affordances(response: Response) {
    const body = await response.json()
    return body.data as Record<string, unknown>
  }

  test('the owner may complete', async () => {
    setTask(makeTask())

    expect(await affordances(await runDetail())).toMatchObject({
      canComplete: true,
      actBlockedReason: null,
    })
  })

  test('a view_all administrator may READ the same row and may not complete it', async () => {
    withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })
    setTask(makeTask({ assignedTo: 'somebody-else' }))

    const response = await runDetail()
    expect(response.status).toBe(200)
    expect(await affordances(response)).toMatchObject({
      canComplete: false,
      canClaim: false,
      actBlockedReason: 'owned-by-another',
    })
  })

  test('names reassignment as reachable when the caller holds the feature, ownership or not', async () => {
    withVisibility({
      acl: {
        features: ['workflows.tasks.view', 'workflows.tasks.view_all', 'workflows.tasks.reassign'],
      },
    })
    setTask(makeTask({ assignedTo: 'somebody-else' }))

    expect(await affordances(await runDetail())).toMatchObject({
      canComplete: false,
      canReassign: true,
    })
  })

  test('withholds reassignment from an administrator who only holds view_all', async () => {
    withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })
    setTask(makeTask({ assignedTo: 'somebody-else' }))

    expect(await affordances(await runDetail())).toMatchObject({ canReassign: false })
  })

  test('the ownerless task is completable by nobody and rescuable by reassignment', async () => {
    withVisibility({
      acl: {
        features: ['workflows.tasks.view', 'workflows.tasks.view_all', 'workflows.tasks.reassign'],
      },
    })
    setTask(makeTask({ assignedTo: null, claimedBy: null, assignedToRoles: null }))

    expect(await affordances(await runDetail())).toMatchObject({
      canComplete: false,
      actBlockedReason: 'unowned',
      canReassign: true,
    })
  })

  test('a queue the caller does not belong to reads as such, not as ownerless', async () => {
    withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })
    setTask(makeTask({ assignedTo: null, assignedToRoles: ['finance'] }))

    expect(await affordances(await runDetail())).toMatchObject({
      canComplete: false,
      canClaim: false,
      actBlockedReason: 'not-in-your-queue',
    })
  })

  test('a queue member may claim an open row', async () => {
    setTask(makeTask({ assignedTo: null, assignedToRoles: ['warehouse'] }))

    expect(await affordances(await runDetail())).toMatchObject({
      canComplete: true,
      canClaim: true,
      actBlockedReason: null,
    })
  })

  test('only the claimant may release, and only while the row is IN_PROGRESS', async () => {
    setTask(
      makeTask({ status: 'IN_PROGRESS', assignedTo: null, assignedToRoles: ['warehouse'], claimedBy: USER_ID }),
    )
    expect(await affordances(await runDetail())).toMatchObject({ canRelease: true })

    setTask(makeTask({ status: 'PENDING', assignedTo: null, assignedToRoles: ['warehouse'] }))
    expect(await affordances(await runDetail())).toMatchObject({ canRelease: false })

    withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })
    setTask(makeTask({ status: 'IN_PROGRESS', assignedTo: null, claimedBy: 'somebody-else' }))
    expect(await affordances(await runDetail())).toMatchObject({ canRelease: false })
  })

  test('a terminal task offers nothing and says why', async () => {
    setTask(makeTask({ status: 'COMPLETED' }))

    expect(await affordances(await runDetail())).toMatchObject({
      canComplete: false,
      canClaim: false,
      canRelease: false,
      canReassign: false,
      actBlockedReason: 'not-workable',
    })
  })

  /**
   * The tenant opt-out restores the READ and never the act path, so the row
   * comes back with its entity gate still shut and every act route answers a
   * bare 404 for it. The stated reason must be exactly as uninformative — naming
   * the binding here would hand the caller what that 404 withholds.
   */
  test('an entity-gated row under the opt-out refuses without naming the binding', async () => {
    withVisibility({
      acl: { features: ['workflows.tasks.view'] },
      businessContextEnabled: false,
      scopedEntityTypes: ['sales:sales_order'],
    })
    setTask(
      makeTask({
        assignedTo: 'somebody-else',
        entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
        entityTypes: ['sales:sales_order'],
      }),
    )

    const data = await affordances(await runDetail())

    expect(data).toMatchObject({
      canComplete: false,
      canClaim: false,
      canRelease: false,
      canReassign: false,
      actBlockedReason: 'unavailable',
    })
    expect(data.blockedEntityType).toBeUndefined()
    expect(JSON.stringify(data)).not.toContain('denied:entity-access')
  })

  /**
   * Additive, not a rewrite: the fields join a payload that must still carry
   * everything it carried before (BACKWARD_COMPATIBILITY.md §7), and an existing
   * consumer that never reads them is unaffected.
   */
  test('is a strict superset of the payload consumers already read', async () => {
    setTask(makeTask())

    const data = await affordances(await runDetail())

    for (const key of [
      'id',
      'workflowInstanceId',
      'stepInstanceId',
      'taskName',
      'status',
      'assignedTo',
      'assigneeKind',
      'assignedToRoles',
      'claimedBy',
      'entityBindings',
      'kind',
      'priority',
      'proposalId',
      'createdAt',
      'updatedAt',
      'stepId',
      'decisions',
    ]) {
      expect(data).toHaveProperty(key)
    }
    expect(userTaskDetailResponseSchema.safeParse({ data }).success).toBe(true)
  })
})
