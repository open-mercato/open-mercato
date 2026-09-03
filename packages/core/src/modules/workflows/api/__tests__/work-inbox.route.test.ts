/**
 * Work Inbox API — merge, filters, ordering, scoping and claim-next.
 *
 * Two properties are load-bearing and are asserted end-to-end through the real
 * handlers: (1) the queue is tenant + organization scoped on every query, and
 * (2) claim-next is atomic — two operators pressing the button on the same
 * candidate list never receive the same task.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { NextRequest } from 'next/server'
import { GET as listWorkInboxRoute } from '../work-inbox/route'
import { POST as claimNextRoute } from '../work-inbox/next/route'
import {
  clearWorkInboxSources,
  registerWorkInboxSources,
} from '../../lib/work-inbox/provider'
import type { WorkInboxRow, WorkInboxSourceProvider } from '../../lib/work-inbox/provider'
import * as workInboxService from '../../lib/work-inbox/service'
import { userTaskWorkInboxSource } from '../../lib/work-inbox/user-task-source'
import { UserTask } from '../../data/entities'
import {
  expectListHandlerOmitsOrganizationForWildcardScope,
  expectListHandlerScopesToFilterIds,
} from './helpers/orgScopeAssertions'
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

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const USER_ID = '11111111-2222-4333-8444-cccccccccccc'

type MockEm = {
  findAndCount: jest.Mock
  findOne: jest.Mock
  nativeUpdate: jest.Mock
  flush: jest.Mock
  getConnection: () => { execute: jest.Mock }
}

let mockEm: MockEm
let taskHandler: { claimUserTask: jest.Mock; completeUserTask: jest.Mock }
let visibilityStubs: TaskVisibilityRouteStubs

function stubSource(kind: string, moduleId: string, rows: WorkInboxRow[]): WorkInboxSourceProvider {
  return { kind, moduleId, list: async () => ({ rows, total: rows.length }) }
}

function makeRow(overrides: Partial<WorkInboxRow> = {}): WorkInboxRow {
  return {
    id: 'row-1',
    kind: 'agent_disposition',
    moduleId: 'agent_orchestrator',
    title: 'Dispose proposal',
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

function resolveScopeMock(): jest.Mock {
  const {
    resolveOrganizationScopeForRequest,
  } = require('@open-mercato/core/modules/directory/utils/organizationScope')
  return resolveOrganizationScopeForRequest as jest.Mock
}

function runList(query = ''): Promise<Response> {
  return listWorkInboxRoute(new NextRequest(`http://localhost/api/workflows/work-inbox${query}`))
}

function runClaimNext(): Promise<Response> {
  return claimNextRoute(
    new NextRequest('http://localhost/api/workflows/work-inbox/next', { method: 'POST' }),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  clearWorkInboxSources()

  // The suite's default caller is an administrator, so the merge, ordering and
  // filter assertions stay about those behaviours; the §6.4 narrowing gets its
  // own describe block below.
  visibilityStubs = makeTaskVisibilityRouteStubs({
    acl: { features: ['workflows.tasks.view', 'workflows.tasks.view_all'] },
  })

  mockEm = {
    findAndCount: jest.fn(async () => [[], 0]),
    findOne: jest.fn(async () => null),
    nativeUpdate: jest.fn(async () => 1),
    flush: jest.fn(async () => undefined),
    getConnection: visibilityStubs.getConnection,
  }

  taskHandler = {
    claimUserTask: jest.fn(async () => undefined),
    completeUserTask: jest.fn(async () => undefined),
  }

  const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'em') return mockEm
      if (name === 'workInboxService') return workInboxService
      if (name === 'taskHandler') return taskHandler
      if (name === 'rbacService') return visibilityStubs.rbacService
      if (name === 'moduleConfigService') return visibilityStubs.moduleConfigService
      return null
    },
  })

  const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
  getAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    roles: ['approver'],
  })

  resolveScopeMock().mockResolvedValue({ selectedId: ORG_ID })

  registerWorkInboxSources([{ moduleId: 'workflows', sources: [userTaskWorkInboxSource] }])
})

describe('GET /api/workflows/work-inbox — scoping', () => {
  test('scopes every listing to the caller tenant and the visible organizations', async () => {
    await expectListHandlerScopesToFilterIds({
      Entity: UserTask,
      findAndCount: mockEm.findAndCount,
      resolveScope: resolveScopeMock(),
      runHandler: () => runList(),
      tenantId: TENANT_ID,
    })
  })

  test('omits the organization predicate only for the wildcard scope', async () => {
    await expectListHandlerOmitsOrganizationForWildcardScope({
      Entity: UserTask,
      findAndCount: mockEm.findAndCount,
      resolveScope: resolveScopeMock(),
      runHandler: () => runList(),
      tenantId: TENANT_ID,
    })
  })

  test('refuses a caller with no tenant context', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: USER_ID, orgId: ORG_ID, roles: [] })

    expect((await runList()).status).toBe(400)
  })

  test('refuses an unauthenticated caller', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue(null)

    expect((await runList()).status).toBe(401)
  })
})

describe('GET /api/workflows/work-inbox — filters and paging', () => {
  test('clamps an oversized limit to the documented maximum', async () => {
    const response = await runList('?limit=5000')
    const body = await response.json()

    expect(body.pagination.limit).toBe(100)
    expect(mockEm.findAndCount.mock.calls[0][2]).toMatchObject({ limit: 100, offset: 0 })
  })

  test('falls back to the default page size for unusable limits and offsets', async () => {
    const response = await runList('?limit=abc&offset=-5')
    const body = await response.json()

    expect(body.pagination).toMatchObject({ limit: 50, offset: 0 })
  })

  test('carries the entity-type, role, priority and status filters into the query', async () => {
    await runList('?entityType=sales:order&role=warehouse&priority=high,extreme&status=PENDING')
    const where = mockEm.findAndCount.mock.calls[0][1] as Record<string, unknown>

    expect(where.$and).toContainEqual({
      $or: [{ entityBindings: { $contains: [{ entityType: 'sales:order' }] } }],
    })
    expect(where.$and).toContainEqual({ assignedToRoles: { $overlap: ['warehouse'] } })
    expect(where.$and).toContainEqual({ priority: { $in: ['high', 'extreme'] } })
    expect(where.$and).toContainEqual({ status: { $in: ['PENDING'] } })
  })

  test('honours the legacy myTasks flag as well as myWork', async () => {
    await runList('?myTasks=true')
    const where = mockEm.findAndCount.mock.calls[0][1] as Record<string, unknown>

    expect(where.$and).toContainEqual({
      $or: [
        { assignedTo: USER_ID },
        { claimedBy: USER_ID },
        { assignedToRoles: { $overlap: ['approver'] } },
      ],
    })
  })

  test('narrowing to a kind nobody registered queries nothing at all', async () => {
    const response = await runList('?kind=agent_disposition')
    const body = await response.json()

    expect(mockEm.findAndCount).not.toHaveBeenCalled()
    expect(body.data).toEqual([])
    expect(body.meta.kinds).toEqual([])
  })
})

describe('GET /api/workflows/work-inbox — merge and row shape', () => {
  test('a user_task row stays a superset of the task-list row', async () => {
    mockEm.findAndCount.mockResolvedValue([[makeTask({ formSchema: { proposalId: 'proposal-9' } })], 1])

    const body = await (await runList()).json()

    expect(body.data[0].proposalId).toBe('proposal-9')
    expect(body.data[0].taskName).toBe('Approve order')
    expect(body.data[0].kind).toBe('user_task')
    expect(body.data[0].detailHref).toBe('/backend/tasks/11111111-2222-4333-8444-555555555555')
  })

  test('merges a second registered source into the same ordered queue', async () => {
    mockEm.findAndCount.mockResolvedValue([[makeTask()], 1])
    registerWorkInboxSources([
      {
        moduleId: 'agent_orchestrator',
        sources: [
          stubSource('agent_disposition', 'agent_orchestrator', [
            makeRow({ id: 'disposition-1', priority: 'extreme' }),
          ]),
        ],
      },
    ])

    const body = await (await runList()).json()

    expect(body.data.map((row: { id: string }) => row.id)).toEqual([
      'disposition-1',
      '11111111-2222-4333-8444-555555555555',
    ])
    expect(body.pagination.total).toBe(2)
    expect(body.meta.kinds.sort()).toEqual(['agent_disposition', 'user_task'])
  })

  test('reports a failing source instead of emptying the inbox', async () => {
    mockEm.findAndCount.mockResolvedValue([[makeTask()], 1])
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

    const body = await (await runList()).json()

    expect(body.data).toHaveLength(1)
    expect(body.meta.degradedKinds).toEqual(['agent_disposition'])
  })
})

describe('GET /api/workflows/work-inbox — the §6.4 read gate', () => {
  function withVisibility(options: Parameters<typeof makeTaskVisibilityRouteStubs>[0]) {
    visibilityStubs = makeTaskVisibilityRouteStubs(options)
    mockEm.getConnection = visibilityStubs.getConnection
  }

  test('narrows an ordinary caller to their own work and viewable entity types', async () => {
    withVisibility({
      acl: { features: ['workflows.tasks.view'] },
      scopedEntityTypes: ['sales:sales_order'],
    })

    await runList()
    const where = mockEm.findAndCount.mock.calls[0][1] as Record<string, unknown>

    expect(where.$and).toContainEqual({
      $or: [
        { assignedTo: USER_ID, assigneeKind: 'user' },
        { claimedBy: USER_ID },
        { assignedToRoles: { $overlap: ['approver'] } },
      ],
    })
    expect(where.$and).toContainEqual({
      $or: [{ entityTypes: null }, { entityTypes: { $contained: [] } }],
    })
  })

  test('the opt-out restores the legacy read filter and adds nothing else', async () => {
    withVisibility({ acl: { features: ['workflows.tasks.view'] }, businessContextEnabled: false })

    await runList()
    const where = mockEm.findAndCount.mock.calls[0][1] as Record<string, unknown>

    expect(where.$and).toBeUndefined()
    expect(where).toMatchObject({ tenantId: TENANT_ID, organizationId: { $in: [ORG_ID] } })
  })

  test('a task about nothing still reaches its own assignee', async () => {
    withVisibility({ acl: { features: ['workflows.tasks.view'] } })
    const legacy = makeTask({
      assignedTo: USER_ID,
      assignedToRoles: null,
      entityBindings: null,
      entityTypes: null,
    })
    delete (legacy as Partial<UserTask>).assigneeKind
    mockEm.findAndCount.mockResolvedValue([[legacy], 1])

    const body = await (await runList()).json()

    expect(body.data).toHaveLength(1)
    expect(body.pagination.total).toBe(1)
  })

  test('costs one ACL load and one type enumeration for the whole merged page', async () => {
    withVisibility({ acl: { features: ['workflows.tasks.view'] } })
    mockEm.findAndCount.mockResolvedValue([
      Array.from({ length: 12 }, (_unused, index) =>
        makeTask({
          id: `11111111-2222-4333-8444-0000000000${String(index).padStart(2, '0')}`,
          assignedTo: USER_ID,
          entityBindings: [{ entityType: 'sales:sales_order', entityId: `order-${index}` }],
        }),
      ),
      12,
    ])

    await runList()

    expect(visibilityStubs.rbacService.loadAcl).toHaveBeenCalledTimes(1)
    expect(visibilityStubs.execute).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/workflows/work-inbox/next — claim-next atomicity', () => {
  const firstTask = makeTask({ id: '11111111-2222-4333-8444-111111111111', priority: 'high' })
  const secondTask = makeTask({ id: '11111111-2222-4333-8444-222222222222', priority: 'low' })

  function withCandidates(tasks: UserTask[]) {
    mockEm.findAndCount.mockResolvedValue([tasks, tasks.length])
    mockEm.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) =>
      tasks.find((task) => task.id === where.id) ?? null,
    )
  }

  test('claims the highest-priority candidate first', async () => {
    withCandidates([secondTask, firstTask])

    const body = await (await runClaimNext()).json()

    expect(taskHandler.claimUserTask).toHaveBeenCalledTimes(1)
    expect(taskHandler.claimUserTask.mock.calls[0][1]).toBe(firstTask.id)
    expect(body.data.id).toBe(firstTask.id)
  })

  test('a caller that loses the race moves on rather than getting the same task', async () => {
    withCandidates([firstTask, secondTask])
    taskHandler.claimUserTask.mockImplementation(async (_em: unknown, taskId: string) => {
      if (taskId === firstTask.id) {
        throw Object.assign(new Error('Task not found or already claimed'), { code: 'TASK_NOT_FOUND' })
      }
    })

    const body = await (await runClaimNext()).json()

    expect(taskHandler.claimUserTask).toHaveBeenCalledTimes(2)
    expect(body.data.id).toBe(secondTask.id)
  })

  test('returns nothing rather than an error when every candidate was taken', async () => {
    withCandidates([firstTask, secondTask])
    taskHandler.claimUserTask.mockImplementation(async () => {
      throw Object.assign(new Error('Task not found or already claimed'), { code: 'TASK_NOT_FOUND' })
    })

    const response = await runClaimNext()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toBeNull()
  })

  test('a real failure is not mistaken for a lost race', async () => {
    withCandidates([firstTask])
    taskHandler.claimUserTask.mockImplementation(async () => {
      throw new Error('[internal] database is down')
    })

    expect((await runClaimNext()).status).toBe(500)
  })

  test('only considers unassigned role-queued PENDING work inside the caller scope', async () => {
    withCandidates([
      makeTask({ id: '11111111-2222-4333-8444-333333333333', assignedTo: USER_ID }),
      makeTask({ id: '11111111-2222-4333-8444-444444444444', assignedToRoles: [] }),
      firstTask,
    ])

    await runClaimNext()

    expect(taskHandler.claimUserTask).toHaveBeenCalledTimes(1)
    expect(taskHandler.claimUserTask.mock.calls[0][1]).toBe(firstTask.id)
    expect(taskHandler.claimUserTask.mock.calls[0][3]).toEqual({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    // The handler re-checks queue membership, so claim-next must hand it the
    // caller's server-derived role names rather than trusting its own filter.
    expect(taskHandler.claimUserTask.mock.calls[0][4]).toEqual(['approver'])
    expect(mockEm.findAndCount.mock.calls[0][1]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: { $in: [ORG_ID] },
    })
  })

  test('refuses a caller with no organization context', async () => {
    resolveScopeMock().mockResolvedValue({ selectedId: null })
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, roles: [] })

    expect((await runClaimNext()).status).toBe(400)
  })
})
