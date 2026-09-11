/**
 * Portal task routes — a NEW surface, and the isolation that makes it safe.
 *
 * These routes exist so a customer can finish work addressed to them. Nothing
 * about the backoffice routes changed to allow it: the backoffice routes still
 * take a backoffice session and still refuse a portal token, and these refuse a
 * backoffice one. Both halves are asserted here, because "we added a route" and
 * "we widened a route" look identical in a diff and only one of them is safe.
 *
 * Every refusal on this surface is the same 404 with the same body. A portal
 * principal has no legitimate knowledge that a row they cannot read exists, so
 * a foreign task, another customer's task, an unbound task and a random uuid
 * must be indistinguishable.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { NextRequest } from 'next/server'
import { UserTask } from '../../data/entities'

const getCustomerAuthFromRequest = jest.fn<(req: Request) => Promise<unknown>>()
const requireCustomerFeature = jest.fn<(...args: unknown[]) => Promise<void>>()
const findWithDecryption = jest.fn<(...args: unknown[]) => Promise<unknown[]>>()
const completeUserTask = jest.fn<(...args: unknown[]) => Promise<void>>()
const loadAcl = jest.fn<(...args: unknown[]) => Promise<{ isPortalAdmin: boolean; features: string[] }>>()
const getAuthFromRequest = jest.fn<(req: Request) => Promise<unknown>>()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (req: Request) => getAuthFromRequest(req),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (req: Request) => getCustomerAuthFromRequest(req),
  requireCustomerFeature: (...args: unknown[]) => requireCustomerFeature(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

const { GET: listPortalTasks } = require('../portal/tasks/route')
const { GET: getPortalTask } = require('../portal/tasks/[id]/route')
const { POST: completePortalTask } = require('../portal/tasks/[id]/complete/route')

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const PORTAL_SUB = 'portal-user-1'
const CUSTOMER_ENTITY_ID = 'customer-record-1'
const PERSON_ENTITY_ID = 'person-record-1'
const TASK_ID = '11111111-2222-4333-8444-555555555555'

type MockEm = { findOne: jest.Mock; findAndCount: jest.Mock }

let mockEm: MockEm
let taskRow: UserTask | null

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const task = new UserTask()
  task.id = TASK_ID
  task.workflowInstanceId = 'instance-1'
  task.stepInstanceId = 'step-instance-1'
  task.taskName = 'Confirm delivery address'
  task.status = 'PENDING'
  task.assignedTo = PORTAL_SUB
  task.assigneeKind = 'customer'
  task.assignedToRoles = null
  task.claimedBy = null
  task.entityBindings = [{ entityType: 'customers:person', entityId: PERSON_ENTITY_ID }]
  task.entityTypes = ['customers:person']
  task.tenantId = TENANT_ID
  task.organizationId = ORG_ID
  task.createdAt = new Date('2026-07-28T09:00:00.000Z')
  task.updatedAt = new Date('2026-07-28T09:00:00.000Z')
  Object.assign(task, overrides)
  return task
}

function signedInAs(overrides: Record<string, unknown> = {}) {
  getCustomerAuthFromRequest.mockResolvedValue({
    sub: PORTAL_SUB,
    sid: 'session-1',
    type: 'customer',
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    email: 'buyer@example.com',
    displayName: 'Buyer',
    customerEntityId: CUSTOMER_ENTITY_ID,
    personEntityId: PERSON_ENTITY_ID,
    resolvedFeatures: ['portal.tasks.view', 'portal.tasks.complete'],
    ...overrides,
  })
}

function runList(query = '') {
  return listPortalTasks(new NextRequest(`http://localhost/api/workflows/portal/tasks${query}`))
}

function runDetail(id = TASK_ID) {
  return getPortalTask(new NextRequest(`http://localhost/api/workflows/portal/tasks/${id}`), {
    params: { id },
  })
}

function runComplete(body: unknown = { formData: {} }, id = TASK_ID) {
  return completePortalTask(
    new NextRequest(`http://localhost/api/workflows/portal/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: { id } },
  )
}

beforeEach(() => {
  jest.clearAllMocks()

  taskRow = null
  mockEm = {
    findOne: jest.fn(async (entity: unknown) => (entity === UserTask ? taskRow : null)),
    findAndCount: jest.fn(async () => [taskRow ? [taskRow] : [], taskRow ? 1 : 0]),
  }
  findWithDecryption.mockResolvedValue([])
  requireCustomerFeature.mockResolvedValue(undefined)
  completeUserTask.mockResolvedValue(undefined)
  loadAcl.mockResolvedValue({ isPortalAdmin: false, features: ['portal.tasks.view'] })
  signedInAs()

  const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'em') return mockEm
      if (name === 'customerRbacService') return { loadAcl, userHasAllFeatures: async () => true }
      if (name === 'taskHandler') return { completeUserTask }
      return null
    },
  })
})

describe('authentication and feature gates', () => {
  test('an unauthenticated caller gets 401 on every portal route', async () => {
    getCustomerAuthFromRequest.mockResolvedValue(null)

    for (const response of [await runList(), await runDetail(), await runComplete()]) {
      expect(response.status).toBe(401)
    }
  })

  test('a portal session without `portal.tasks.view` is refused by the singular helper', async () => {
    const { NextResponse } = require('next/server')
    requireCustomerFeature.mockRejectedValue(
      NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 }),
    )

    expect((await runList()).status).toBe(403)
    expect(requireCustomerFeature).toHaveBeenCalledWith(
      expect.anything(),
      ['portal.tasks.view'],
      expect.anything(),
    )
  })

  test('completing demands `portal.tasks.complete`, not merely `.view`', async () => {
    taskRow = makeTask()
    await runComplete()

    expect(requireCustomerFeature).toHaveBeenCalledWith(
      expect.anything(),
      ['portal.tasks.complete'],
      expect.anything(),
    )
  })

  test('a portal principal with no company association is refused with 403', async () => {
    signedInAs({ customerEntityId: null })

    const response = await runList()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, error: 'No company association' })
  })
})

describe('the list', () => {
  test('returns the principal\'s own bound task', async () => {
    taskRow = makeTask()

    const response = await runList()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].id).toBe(TASK_ID)
  })

  test('queries only customer-assigned, bound rows for this principal', async () => {
    await runList()

    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      UserTask,
      expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        assigneeKind: 'customer',
        assignedTo: { $in: [PORTAL_SUB] },
        entityTypes: { $ne: null },
      }),
      expect.any(Object),
    )
  })

  test('drops a row the SQL admitted but ownership refuses', async () => {
    // Assigned to this principal, bound to somebody else's record: the arm
    // cannot express ownership, so the predicate is what removes it.
    taskRow = makeTask({
      entityBindings: [{ entityType: 'customers:person', entityId: 'person-record-999' }],
    })

    const body = await (await runList()).json()
    expect(body.tasks).toEqual([])
  })

  test('caps the page size at 100 however large the request asks for', async () => {
    await runList('?pageSize=5000')

    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      UserTask,
      expect.anything(),
      expect.objectContaining({ limit: 100 }),
    )
  })
})

describe('the detail route and its refusals', () => {
  test('returns the task with `canComplete` for its assignee', async () => {
    taskRow = makeTask()

    const body = await (await runDetail()).json()
    expect(body).toMatchObject({ ok: true, canComplete: true })
    expect(body.task.id).toBe(TASK_ID)
  })

  test('an unbound task is a 404, not a 200', async () => {
    taskRow = makeTask({ entityBindings: null, entityTypes: null })

    expect((await runDetail()).status).toBe(404)
  })

  test('another customer\'s task is a 404', async () => {
    taskRow = makeTask({
      assignedTo: 'portal-user-2',
      entityBindings: [{ entityType: 'customers:person', entityId: 'person-record-999' }],
    })

    expect((await runDetail()).status).toBe(404)
  })

  test('a nonexistent id and a task they may not read are byte-identical', async () => {
    taskRow = null
    const missing = await runDetail('11111111-2222-4333-8444-999999999999')
    const missingBody = await missing.text()

    taskRow = makeTask({ assigneeKind: 'user' })
    const refused = await runDetail()

    expect(refused.status).toBe(missing.status)
    expect(await refused.text()).toBe(missingBody)
  })

  test('the lookup carries tenant AND organization, so a foreign id never resolves', async () => {
    await runDetail()

    expect(mockEm.findOne).toHaveBeenCalledWith(
      UserTask,
      expect.objectContaining({ id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID }),
    )
  })
})

describe('completion', () => {
  test('the assignee completes their own task', async () => {
    taskRow = makeTask()

    const response = await runComplete({ formData: { confirmed: true } })

    expect(response.status).toBe(200)
    expect(completeUserTask).toHaveBeenCalledWith(
      mockEm,
      expect.anything(),
      expect.objectContaining({
        taskId: TASK_ID,
        userId: PORTAL_SUB,
        formData: { confirmed: true },
        scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      }),
    )
  })

  test('an unbound task cannot be completed and nothing is written', async () => {
    taskRow = makeTask({ entityBindings: [], entityTypes: null })

    expect((await runComplete()).status).toBe(404)
    expect(completeUserTask).not.toHaveBeenCalled()
  })

  test('a portal admin may READ a company member\'s task but not complete it', async () => {
    loadAcl.mockResolvedValue({ isPortalAdmin: true, features: ['*'] })
    findWithDecryption.mockResolvedValue([
      { id: PORTAL_SUB, personEntityId: PERSON_ENTITY_ID, customerEntityId: CUSTOMER_ENTITY_ID },
      { id: 'portal-user-2', personEntityId: 'person-record-2', customerEntityId: CUSTOMER_ENTITY_ID },
    ])
    taskRow = makeTask({
      assignedTo: 'portal-user-2',
      entityBindings: [{ entityType: 'customers:person', entityId: 'person-record-2' }],
    })

    const detail = await (await runDetail()).json()
    expect(detail).toMatchObject({ ok: true, canComplete: false })

    expect((await runComplete()).status).toBe(404)
    expect(completeUserTask).not.toHaveBeenCalled()
  })

  test('a malformed body is a 400 before any lookup', async () => {
    taskRow = makeTask()

    expect((await runComplete({ comments: 'no form data' })).status).toBe(400)
    expect(completeUserTask).not.toHaveBeenCalled()
  })
})

describe('a portal admin gains nothing across customers', () => {
  test('a task outside their company stays a 404 even with `[*]` grants', async () => {
    loadAcl.mockResolvedValue({ isPortalAdmin: true, features: ['*'] })
    findWithDecryption.mockResolvedValue([
      { id: PORTAL_SUB, personEntityId: PERSON_ENTITY_ID, customerEntityId: CUSTOMER_ENTITY_ID },
    ])
    signedInAs({ resolvedFeatures: ['*'] })
    taskRow = makeTask({
      assignedTo: 'portal-user-from-another-company',
      entityBindings: [{ entityType: 'customers:person', entityId: 'person-record-999' }],
    })

    expect((await runDetail()).status).toBe(404)
  })

  test('their list query still names only their own company\'s members', async () => {
    loadAcl.mockResolvedValue({ isPortalAdmin: true, features: ['*'] })
    findWithDecryption.mockResolvedValue([
      { id: PORTAL_SUB, personEntityId: PERSON_ENTITY_ID, customerEntityId: CUSTOMER_ENTITY_ID },
      { id: 'portal-user-2', personEntityId: 'person-record-2', customerEntityId: CUSTOMER_ENTITY_ID },
    ])

    await runList()

    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      UserTask,
      expect.objectContaining({ assignedTo: { $in: [PORTAL_SUB, 'portal-user-2'] } }),
      expect.any(Object),
    )
  })
})

describe('cross-principal isolation', () => {
  test('a backoffice row is invisible on the portal surface, whatever it is assigned to', async () => {
    taskRow = makeTask({ assigneeKind: 'user' })

    expect((await runDetail()).status).toBe(404)
    expect((await runComplete()).status).toBe(404)
  })

  test('a portal token is refused by the BACKOFFICE task route with 401', async () => {
    // `getAuthFromRequest` verifies the backoffice JWT audience; a customer
    // token is not one, so it resolves to null and the backoffice route answers
    // 401 without ever reaching the visibility rule. This is the other direction
    // of the isolation, and it is why the portal surface is new API rather than
    // a relaxed rule on the existing one.
    getAuthFromRequest.mockResolvedValue(null)
    const { GET: listBackofficeTasks } = require('../tasks/route')

    const response = await listBackofficeTasks(
      new NextRequest('http://localhost/api/workflows/tasks'),
    )

    expect(response.status).toBe(401)
  })

  test('the portal routes never consult the backoffice auth reader', async () => {
    taskRow = makeTask()
    await runList()
    await runDetail()
    await runComplete()

    expect(getAuthFromRequest).not.toHaveBeenCalled()
  })
})
