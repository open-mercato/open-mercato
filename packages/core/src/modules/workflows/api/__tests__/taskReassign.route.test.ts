/**
 * `POST /api/workflows/tasks/[id]/reassign`.
 *
 * The properties this route exists for, asserted directly:
 *
 * - **It rescues the shape §6.4 makes uncompletable.** A task with no assignee,
 *   no claim and no role queue belongs to nobody; the act routes answer
 *   `TASK_NOT_ACTIONABLE` and name reassignment as the remedy. If this endpoint
 *   also required ownership the remedy would be unreachable, so the gate checks
 *   VISIBILITY only.
 * - **It refuses to CREATE that shape.** A body naming neither an assignee nor a
 *   role queue is a 400, not a write.
 * - **`UserTask` is outside the curated optimistic-lock list** and the coverage
 *   guard only matches `PUT`/`PATCH`/`DELETE`, so nothing enforces the header
 *   automatically. A stale `x-om-ext-optimistic-lock-expected-updated-at` must
 *   still produce the same structured 409 every CRUD surface returns.
 * - **The feature gate is the route's**, so a caller without
 *   `workflows.tasks.reassign` never reaches the handler.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { NextRequest } from 'next/server'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { POST as reassignTask, metadata } from '../tasks/[id]/reassign/route'
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
const ADMIN_ID = 'admin-1'
const WORKER_ID = 'user-2'
const TASK_ID = '11111111-2222-4333-8444-555555555555'
const LOADED_AT = '2026-07-28T09:00:00.000Z'

type MockEm = { findOne: jest.Mock; getConnection: () => { execute: jest.Mock } }

let mockEm: MockEm
let stubs: TaskVisibilityRouteStubs
let taskHandler: { reassignUserTask: jest.Mock }
let taskRow: UserTask | null

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const task = new UserTask()
  task.id = TASK_ID
  task.workflowInstanceId = '11111111-2222-4333-8444-666666666666'
  task.stepInstanceId = '11111111-2222-4333-8444-777777777777'
  task.taskName = 'Approve order'
  task.status = 'PENDING'
  task.assignedTo = null
  task.assigneeKind = 'user'
  task.assignedToRoles = null
  task.claimedBy = null
  task.entityBindings = null
  task.entityTypes = null
  task.tenantId = TENANT_ID
  task.organizationId = ORG_ID
  task.createdAt = new Date(LOADED_AT)
  task.updatedAt = new Date(LOADED_AT)
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
    sub: overrides.sub ?? ADMIN_ID,
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    roles: overrides.roles ?? [],
  })
}

function runReassign(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return reassignTask(
    new NextRequest(`http://localhost/api/workflows/tasks/${TASK_ID}/reassign`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    }),
    { params: { id: TASK_ID } },
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
    reassignUserTask: jest.fn(async () => makeTask({ assignedTo: WORKER_ID })),
  }

  withVisibility({ acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] } })
  setAuth()

  const {
    resolveOrganizationScopeForRequest,
  } = require('@open-mercato/core/modules/directory/utils/organizationScope')
  resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: ORG_ID })
})

describe('route feature gate', () => {
  test('the endpoint is declared behind workflows.tasks.reassign', () => {
    // The refusal itself comes from the API catch-all, which reads this
    // metadata — asserting the declaration is what pins the gate.
    expect(metadata.requireFeatures).toEqual(['workflows.tasks.reassign'])
    expect(metadata.requireAuth).toBe(true)
  })

  test('a caller who cannot see the row is refused as not found, never reaching the handler', async () => {
    // No `view_all`, no relationship to the row: the same answer a nonexistent
    // id produces, so holding `reassign` on paper discloses nothing.
    withVisibility({ acl: { features: ['workflows.tasks.view'] } })
    taskRow = makeTask({ assignedTo: WORKER_ID })

    const { status, body } = await bodyAndStatus(await runReassign({ assignedTo: ADMIN_ID }))

    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Task not found' })
    expect(taskHandler.reassignUserTask).not.toHaveBeenCalled()
  })
})

describe('rescuing a task that belongs to nobody', () => {
  test('an ownerless task is reassignable to a real assignee', async () => {
    // The hole §6.4 opens: no assignee, no claim, no role queue. `view_all`
    // makes it VISIBLE and never actable, and this is the only way out.
    taskRow = makeTask({ assignedTo: null, assignedToRoles: null, claimedBy: null })

    const { status } = await bodyAndStatus(
      await runReassign({ assignedTo: WORKER_ID, reason: 'Nobody owned it' }),
    )

    expect(status).toBe(200)
    expect(taskHandler.reassignUserTask).toHaveBeenCalledTimes(1)
    const [, options] = taskHandler.reassignUserTask.mock.calls[0] as [
      unknown,
      { userId: string; target: { assignedTo: string | null; assignedToRoles: string[] | null }; reason: string | null },
    ]
    expect(options.userId).toBe(ADMIN_ID)
    expect(options.target).toEqual({ assignedTo: WORKER_ID, assignedToRoles: null })
    expect(options.reason).toBe('Nobody owned it')
  })

  test('an ownerless task can be put onto a role queue instead', async () => {
    taskRow = makeTask()

    expect((await runReassign({ assignedToRoles: ['approver'] })).status).toBe(200)
    const [, options] = taskHandler.reassignUserTask.mock.calls[0] as [
      unknown,
      { target: { assignedTo: string | null; assignedToRoles: string[] | null } },
    ]
    expect(options.target).toEqual({ assignedTo: null, assignedToRoles: ['approver'] })
  })

  test('a body naming neither an assignee nor a queue is refused', async () => {
    // Refusing here is what stops reassignment from MINTING the uncompletable
    // shape it exists to repair.
    taskRow = makeTask({ assignedTo: WORKER_ID })

    for (const body of [{}, { assignedTo: '   ' }, { assignedToRoles: [] }, { assignedTo: null, assignedToRoles: null }]) {
      const { status } = await bodyAndStatus(await runReassign(body))
      expect(status).toBe(400)
    }
    expect(taskHandler.reassignUserTask).not.toHaveBeenCalled()
  })
})

describe('optimistic locking', () => {
  test('a stale expected version is refused with the structured 409', async () => {
    taskRow = makeTask({ assignedTo: WORKER_ID })

    const { status, body } = await bodyAndStatus(
      await runReassign(
        { assignedTo: ADMIN_ID },
        { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-07-27T09:00:00.000Z' },
      ),
    )

    expect(status).toBe(409)
    expect(body.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
    expect(taskHandler.reassignUserTask).not.toHaveBeenCalled()
  })

  test('the matching expected version passes through', async () => {
    taskRow = makeTask({ assignedTo: WORKER_ID })

    const response = await runReassign(
      { assignedTo: ADMIN_ID },
      { [OPTIMISTIC_LOCK_HEADER_NAME]: LOADED_AT },
    )

    expect(response.status).toBe(200)
    expect(taskHandler.reassignUserTask).toHaveBeenCalledTimes(1)
  })

  test('a client that sends no header is unaffected', async () => {
    taskRow = makeTask({ assignedTo: WORKER_ID })

    expect((await runReassign({ assignedTo: ADMIN_ID })).status).toBe(200)
  })
})

describe('terminal tasks', () => {
  test('the handler refusal surfaces as a conflict, not a 500', async () => {
    taskRow = makeTask({ status: 'COMPLETED', assignedTo: WORKER_ID })
    taskHandler.reassignUserTask.mockImplementation(async () => {
      throw Object.assign(new Error('Task is no longer open and cannot be reassigned'), {
        code: 'TASK_NOT_REASSIGNABLE',
      })
    })

    const { status, body } = await bodyAndStatus(await runReassign({ assignedTo: ADMIN_ID }))

    expect(status).toBe(409)
    expect(body.code).toBe('TASK_NOT_REASSIGNABLE')
  })
})
