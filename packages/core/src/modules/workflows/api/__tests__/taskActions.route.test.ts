/**
 * Claim / unclaim / complete under the §6.4 act gate.
 *
 * The change these tests pin is exactly the one the spec asks for: holding
 * `workflows.tasks.complete` no longer completes ANYONE's task, only your own.
 * Per maintainer decision D-1 the feature stays on the route as `requireFeatures`
 * — it admits you to the endpoint, and the rule decides which row you may touch.
 *
 * Three properties are easy to lose and are asserted directly:
 *
 * - **The owner is `claimedBy ?? assignedTo`.** A colleague who holds the same
 *   queued role as the claimant must not be able to complete the claimant's
 *   work; membership in a queue confers the right to CLAIM, not to take over.
 * - **`view_all` widens seeing, never acting.** An administrator sees a
 *   colleague's task and is refused when they try to finish it.
 * - **Refusals are indistinguishable.** The gate runs before the task handler,
 *   so a caller with no relationship cannot tell "already claimed" from "does
 *   not exist" — which is what the handler's own ordering used to leak.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { NextRequest } from 'next/server'
import { POST as claimTask } from '../tasks/[id]/claim/route'
import { POST as unclaimTask } from '../tasks/[id]/unclaim/route'
import { POST as completeTask } from '../tasks/[id]/complete/route'
import { UserTask } from '../../data/entities'
import { makeTaskVisibilityRouteStubs, type TaskVisibilityRouteStubs } from './helpers/taskVisibilityRoute'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/entities/lib/entityClassification', () => ({
  classifyRecordsEntity: jest.fn(async () => ({ kind: 'custom', restricted: true })),
}))

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const USER_ID = 'user-1'
const COLLEAGUE_ID = 'user-2'
const TASK_ID = '11111111-2222-4333-8444-555555555555'
const MISSING_ID = '11111111-2222-4333-8444-999999999999'

type MockEm = { findOne: jest.Mock; getConnection: () => { execute: jest.Mock } }

let mockEm: MockEm
let stubs: TaskVisibilityRouteStubs
let taskHandler: {
  claimUserTask: jest.Mock
  releaseUserTask: jest.Mock
  completeUserTask: jest.Mock
}
let taskRow: UserTask | null

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
  task.assignedTo = null
  task.assigneeKind = 'user'
  task.assignedToRoles = ['approver']
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
      if (name === 'taskHandler') return taskHandler
      if (name === 'rbacService') return stubs.rbacService
      if (name === 'moduleConfigService') return stubs.moduleConfigService
      return null
    },
  })
}

function setAuth(overrides: { sub?: string; roles?: string[] } = {}) {
  const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
  getAuthFromRequest.mockResolvedValue({
    sub: overrides.sub ?? USER_ID,
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    roles: overrides.roles ?? ['approver'],
  })
}

function runClaim(id = TASK_ID) {
  return claimTask(
    new NextRequest(`http://localhost/api/workflows/tasks/${id}/claim`, { method: 'POST' }),
    { params: { id } },
  )
}

function runUnclaim(id = TASK_ID) {
  return unclaimTask(
    new NextRequest(`http://localhost/api/workflows/tasks/${id}/unclaim`, { method: 'POST' }),
    { params: { id } },
  )
}

function runComplete(id = TASK_ID) {
  return completeTask(
    new NextRequest(`http://localhost/api/workflows/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ formData: {} }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: { id } },
  )
}

async function bodyAndStatus(response: Response) {
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  jest.clearAllMocks()

  taskRow = null
  mockEm = {
    findOne: jest.fn(async (entity: unknown) => (entity === UserTask ? taskRow : null)),
    getConnection: () => ({ execute: jest.fn() }),
  }
  taskHandler = {
    claimUserTask: jest.fn(async () => undefined),
    releaseUserTask: jest.fn(async () => undefined),
    completeUserTask: jest.fn(async () => undefined),
  }

  withVisibility({ acl: { features: ['workflows.tasks.view'] } })
  setAuth()

  const {
    resolveOrganizationScopeForRequest,
  } = require('@open-mercato/core/modules/directory/utils/organizationScope')
  resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: ORG_ID })
})

describe('acting on work that is yours', () => {
  test('the assignee completes their own task', async () => {
    setTask(makeTask({ assignedTo: USER_ID, assignedToRoles: null }))

    expect((await runComplete()).status).toBe(200)
    expect(taskHandler.completeUserTask).toHaveBeenCalledTimes(1)
  })

  test('a role-queue member claims, then completes what they claimed', async () => {
    setTask(makeTask())
    expect((await runClaim()).status).toBe(200)
    expect(taskHandler.claimUserTask).toHaveBeenCalledTimes(1)

    setTask(makeTask({ status: 'IN_PROGRESS', claimedBy: USER_ID }))
    expect((await runComplete()).status).toBe(200)
    expect(taskHandler.completeUserTask).toHaveBeenCalledTimes(1)
  })

  test('the claimant releases their own claim', async () => {
    setTask(makeTask({ status: 'IN_PROGRESS', claimedBy: USER_ID }))

    expect((await runUnclaim()).status).toBe(200)
    expect(taskHandler.releaseUserTask).toHaveBeenCalledTimes(1)
  })

  test('a legacy row with null entity columns is still actionable by its assignee', async () => {
    const legacy = makeTask({
      assignedTo: USER_ID,
      assignedToRoles: null,
      entityBindings: null,
      entityTypes: null,
    })
    delete (legacy as Partial<UserTask>).assigneeKind
    setTask(legacy)

    expect((await runComplete()).status).toBe(200)
  })
})

describe('acting on work that is not yours', () => {
  test('a colleague in the same queue cannot complete what the claimant claimed', async () => {
    // The owner is `claimedBy ?? assignedTo`. Holding the queued role gets you
    // the right to CLAIM an open row, never to take over a claimed one.
    setAuth({ sub: COLLEAGUE_ID, roles: ['approver'] })
    setTask(makeTask({ status: 'IN_PROGRESS', claimedBy: USER_ID }))

    const { status, body } = await bodyAndStatus(await runComplete())

    // Visible (they hold the queued role), refused before the write with the
    // same code and message the task handler has always used for this case.
    expect(status).toBe(409)
    expect(body.code).toBe('TASK_ASSIGNED_TO_ANOTHER_USER')
    expect(taskHandler.completeUserTask).not.toHaveBeenCalled()
  })

  test('a colleague in the same queue cannot release the claimant claim', async () => {
    setAuth({ sub: COLLEAGUE_ID, roles: ['approver'] })
    setTask(makeTask({ status: 'IN_PROGRESS', claimedBy: USER_ID }))
    taskHandler.releaseUserTask.mockImplementation(async () => {
      throw Object.assign(new Error('Task is claimed by another user'), {
        code: 'TASK_ASSIGNED_TO_ANOTHER_USER',
      })
    })

    expect((await runUnclaim()).status).toBe(409)
  })

  test('an unrelated colleague gets the missing-task answer, not a conflict', async () => {
    setAuth({ sub: COLLEAGUE_ID, roles: [] })
    setTask(makeTask({ assignedTo: USER_ID, assignedToRoles: null }))

    const refused = await bodyAndStatus(await runComplete())

    expect(refused).toEqual({ status: 404, body: { error: 'Task not found' } })
    expect(taskHandler.completeUserTask).not.toHaveBeenCalled()
  })

  test('an administrator with view_all sees the task but may not complete it', async () => {
    setAuth({ sub: COLLEAGUE_ID, roles: [] })
    withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })
    setTask(makeTask({ assignedTo: USER_ID, assignedToRoles: null }))

    const { status, body } = await bodyAndStatus(await runComplete())

    // Not a 404 — they can see it — but administration never grants act. To
    // finish it they must reassign it to themselves first, which is audited.
    expect(status).toBe(409)
    expect(body.code).toBe('TASK_ASSIGNED_TO_ANOTHER_USER')
    expect(taskHandler.completeUserTask).not.toHaveBeenCalled()
  })

  test('a task nobody owns is refused outright, not completed by whoever asks', async () => {
    // The pre-change semantics let anyone holding `workflows.tasks.complete`
    // finish an unassigned, unqueued task. §6.4 makes it nobody's until it is
    // reassigned, and the route says so instead of failing obscurely.
    setAuth({ sub: COLLEAGUE_ID, roles: [] })
    withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })
    setTask(makeTask({ assignedTo: null, assignedToRoles: null }))

    const { status, body } = await bodyAndStatus(await runComplete())

    expect(status).toBe(403)
    expect(body.code).toBe('TASK_NOT_ACTIONABLE')
    expect(taskHandler.completeUserTask).not.toHaveBeenCalled()
  })
})

describe('claim disclosure ordering', () => {
  test('a non-member cannot tell an assigned task from a nonexistent one', async () => {
    // `claimUserTask` reports TASK_ALREADY_ASSIGNED (409) BEFORE it checks queue
    // membership. Without the gate in front, that status is an existence oracle.
    setAuth({ sub: COLLEAGUE_ID, roles: ['other-queue'] })
    setTask(makeTask({ assignedTo: USER_ID, assignedToRoles: null }))
    const refused = await bodyAndStatus(await runClaim())

    setTask(null)
    const missing = await bodyAndStatus(await runClaim(MISSING_ID))

    expect(refused).toEqual(missing)
    expect(refused).toEqual({ status: 404, body: { error: 'Task not found' } })
    expect(taskHandler.claimUserTask).not.toHaveBeenCalled()
  })

  test('a queue member still gets the precise conflict for an assigned task', async () => {
    setTask(makeTask({ assignedTo: USER_ID }))
    setAuth({ sub: COLLEAGUE_ID, roles: ['approver'] })
    taskHandler.claimUserTask.mockImplementation(async () => {
      throw Object.assign(new Error('Task is already assigned to a specific user'), {
        code: 'TASK_ALREADY_ASSIGNED',
      })
    })

    expect((await runClaim()).status).toBe(409)
  })

  test('an empty role queue is the handler own conflict, not a server error', async () => {
    // `TASK_NOT_ROLE_ASSIGNED` matched none of the old message arms and answered
    // 500. The act gate deliberately does not pre-empt it: the handler's code is
    // more precise than a generic "not yours" refusal would be.
    withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })
    setTask(makeTask({ assignedToRoles: null }))
    taskHandler.claimUserTask.mockImplementation(async () => {
      throw Object.assign(new Error('Task is not assigned to any roles'), {
        code: 'TASK_NOT_ROLE_ASSIGNED',
      })
    })

    expect((await runClaim()).status).toBe(409)
  })

  test('a cross-tenant id is refused before the handler can write anything', async () => {
    // The gate's lookup carries the tenant, so the row never resolves and
    // `claimUserTask`'s conditional UPDATE is never reached.
    setTask(null)

    expect(await bodyAndStatus(await runClaim())).toEqual({
      status: 404,
      body: { error: 'Task not found' },
    })
    expect(taskHandler.claimUserTask).not.toHaveBeenCalled()
  })
})

describe('the entity gate on the act path', () => {
  test('an assignee who may not view the bound entity cannot complete the task', async () => {
    withVisibility({ acl: { features: ['workflows.tasks.view'] } })
    setTask(
      makeTask({
        assignedTo: USER_ID,
        assignedToRoles: null,
        entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
        entityTypes: ['sales:sales_order'],
      }),
    )

    expect(await bodyAndStatus(await runComplete())).toEqual({
      status: 404,
      body: { error: 'Task not found' },
    })
    expect(taskHandler.completeUserTask).not.toHaveBeenCalled()
  })

  test('the tenant opt-out restores the read and does NOT re-open acting', async () => {
    // The flag is a SELECT filter, not an authorization mode: the row comes
    // back from a read, and the act path stays closed.
    withVisibility({
      acl: { features: ['workflows.tasks.view'] },
      businessContextEnabled: false,
    })
    setTask(
      makeTask({
        assignedTo: USER_ID,
        assignedToRoles: null,
        entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
        entityTypes: ['sales:sales_order'],
      }),
    )

    expect(await bodyAndStatus(await runComplete())).toEqual({
      status: 404,
      body: { error: 'Task not found' },
    })
    expect(taskHandler.completeUserTask).not.toHaveBeenCalled()
  })

  test('the opt-out does not let an unrelated colleague claim a queue they are not in', async () => {
    withVisibility({
      acl: { features: ['workflows.tasks.view'] },
      businessContextEnabled: false,
    })
    setAuth({ sub: COLLEAGUE_ID, roles: ['other-queue'] })
    setTask(makeTask())
    taskHandler.claimUserTask.mockImplementation(async () => {
      throw Object.assign(new Error('Task not found or already claimed'), {
        code: 'TASK_NOT_FOUND',
      })
    })

    // The read is restored, so the row is visible and the handler is reached —
    // and the handler refuses queue membership exactly as it does with the flag
    // on.
    expect((await runClaim()).status).toBe(404)
    expect(taskHandler.claimUserTask).toHaveBeenCalledTimes(1)
  })

  test('a superadmin is not stopped by the entity gate', async () => {
    withVisibility({ acl: { isSuperAdmin: true } })
    setTask(
      makeTask({
        assignedTo: USER_ID,
        assignedToRoles: null,
        entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
        entityTypes: ['sales:sales_order'],
      }),
    )
    setAuth({ sub: USER_ID, roles: [] })

    expect((await runComplete()).status).toBe(200)
  })
})

describe('act-gate cost', () => {
  test('costs one ACL load and no table-wide type enumeration', async () => {
    setTask(makeTask({ assignedTo: USER_ID, assignedToRoles: null }))

    await runComplete()

    expect(stubs.rbacService.loadAcl).toHaveBeenCalledTimes(1)
    expect(stubs.execute).not.toHaveBeenCalled()
  })
})
