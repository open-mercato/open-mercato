/** @jest-environment node */
// T3.4 route coverage. The one thing these endpoints must never do is let a
// caller tag — or learn about — a task or entry on a project they cannot see, so
// every case here is about `resolveProjectAccess` being consulted BEFORE the
// target is touched, and about the refusal being indistinguishable from "no such
// record". Tenant scoping is asserted on the lookup itself, not inferred.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockResolveProjectAccess = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()
const mockFindOne = jest.fn()

const mockEm = {
  fork: jest.fn(() => mockEm),
  findOne: jest.fn((...args: unknown[]) => mockFindOne(...args)),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { getGrantedFeatures: jest.fn(async () => []) }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))

jest.mock('../../../../lib/time-tracking/access', () => ({
  resolveProjectAccess: jest.fn((args: unknown) => mockResolveProjectAccess(args)),
}))

jest.mock('../../../guards', () => ({
  ...jest.requireActual('../../../guards'),
  resolveUserFeatures: jest.fn(() => []),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) => mockRunAfterSuccess(...args)),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const VISIBLE_PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const HIDDEN_PROJECT_ID = '44444444-4444-4444-8444-4444444444ff'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const TAG_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

type TaskRoute = typeof import('../task-assignments/route')
type EntryRoute = typeof import('../entry-assignments/route')

let taskRoute: TaskRoute
let entryRoute: EntryRoute

beforeAll(async () => {
  taskRoute = await import('../task-assignments/route')
  entryRoute = await import('../entry-assignments/route')
})

function request(url: string, method: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function taskRequest(method: string, body: unknown = { taskId: TASK_ID, tagIds: [TAG_ID] }) {
  return request('/api/staff/timesheets/tags/task-assignments', method, body)
}

function entryRequest(method: string, body: unknown = { timeEntryId: ENTRY_ID, tagIds: [TAG_ID] }) {
  return request('/api/staff/timesheets/tags/entry-assignments', method, body)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuthFromRequest.mockResolvedValue({
    sub: 'user-1',
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    features: ['staff.timesheets.tasks.manage'],
  })
  mockResolveOrganizationScope.mockResolvedValue({ tenantId: TENANT_ID, selectedId: ORG_ID, filterIds: [ORG_ID] })
  mockResolveProjectAccess.mockResolvedValue({
    canManageAll: false,
    projectIds: [VISIBLE_PROJECT_ID],
    staffMemberId: 'member-1',
  })
  mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
  mockExecute.mockResolvedValue({
    result: { targetId: TASK_ID, assignedTagIds: [TAG_ID], alreadyAssignedTagIds: [], tagIds: [TAG_ID] },
    logEntry: null,
  })
  mockFindOne.mockResolvedValue({
    id: TASK_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeProjectId: VISIBLE_PROJECT_ID,
    staffMemberId: 'member-1',
    lockedReportId: null,
  })
})

describe('task tag assignment route', () => {
  it('assigns tags on a project the caller is a member of', async () => {
    const response = await taskRoute.POST(taskRequest('POST'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      taskId: TASK_ID,
      tagIds: [TAG_ID],
      assignedTagIds: [TAG_ID],
      alreadyAssignedTagIds: [],
    })
    expect(mockExecute).toHaveBeenCalledWith(
      'staff.timesheets.tags.assign_task',
      expect.objectContaining({
        input: expect.objectContaining({ taskId: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID }),
      }),
    )
  })

  it('scopes the task lookup by tenant and organization', async () => {
    await taskRoute.POST(taskRequest('POST'))

    expect(mockFindOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: TASK_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      }),
    )
  })

  it('refuses a task on a project the caller cannot see, without confirming it exists', async () => {
    mockFindOne.mockResolvedValue({
      id: TASK_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: HIDDEN_PROJECT_ID,
    })

    const response = await taskRoute.POST(taskRequest('POST'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Task not found or not accessible.' })
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunStaffMutationGuards).not.toHaveBeenCalled()
  })

  it('answers a task that does not exist with the very same body', async () => {
    mockFindOne.mockResolvedValue(null)

    const response = await taskRoute.POST(taskRequest('POST'))
    const missingBody = await response.json()

    mockFindOne.mockResolvedValue({
      id: TASK_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: HIDDEN_PROJECT_ID,
    })
    const deniedResponse = await taskRoute.POST(taskRequest('POST'))

    expect(response.status).toBe(deniedResponse.status)
    await expect(deniedResponse.json()).resolves.toEqual(missingBody)
  })

  it('lets a manager through for any project', async () => {
    mockResolveProjectAccess.mockResolvedValue({ canManageAll: true, projectIds: [], staffMemberId: null })
    mockFindOne.mockResolvedValue({
      id: TASK_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: HIDDEN_PROJECT_ID,
    })

    const response = await taskRoute.POST(taskRequest('POST'))

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalled()
  })

  it('routes DELETE to the unassign command', async () => {
    mockExecute.mockResolvedValue({
      result: { targetId: TASK_ID, removedTagIds: [TAG_ID], notAssignedTagIds: [], tagIds: [] },
      logEntry: null,
    })

    const response = await taskRoute.DELETE(taskRequest('DELETE'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      taskId: TASK_ID,
      tagIds: [],
      removedTagIds: [TAG_ID],
      notAssignedTagIds: [],
    })
    expect(mockExecute).toHaveBeenCalledWith('staff.timesheets.tags.unassign_task', expect.anything())
  })

  it('stops on a blocked mutation guard', async () => {
    mockRunStaffMutationGuards.mockResolvedValue({
      ok: false,
      errorBody: { error: 'Blocked' },
      errorStatus: 423,
      afterSuccessCallbacks: [],
    })

    const response = await taskRoute.POST(taskRequest('POST'))

    expect(response.status).toBe(423)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('time entry tag assignment route', () => {
  beforeEach(() => {
    mockExecute.mockResolvedValue({
      result: { targetId: ENTRY_ID, assignedTagIds: [TAG_ID], alreadyAssignedTagIds: [], tagIds: [TAG_ID] },
      logEntry: null,
    })
    mockFindOne.mockResolvedValue({
      id: ENTRY_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: VISIBLE_PROJECT_ID,
      staffMemberId: 'member-1',
      lockedReportId: null,
    })
  })

  it('assigns tags on an entry of a visible project', async () => {
    const response = await entryRoute.POST(entryRequest('POST'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      timeEntryId: ENTRY_ID,
      tagIds: [TAG_ID],
      assignedTagIds: [TAG_ID],
      alreadyAssignedTagIds: [],
    })
  })

  it('refuses an entry on a project the caller cannot see', async () => {
    mockFindOne.mockResolvedValue({
      id: ENTRY_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: HIDDEN_PROJECT_ID,
      staffMemberId: 'member-9',
      lockedReportId: null,
    })

    const response = await entryRoute.POST(entryRequest('POST'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Time entry not found or not accessible.' })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('lets the owner tag their own project-less entry', async () => {
    mockFindOne.mockResolvedValue({
      id: ENTRY_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: null,
      staffMemberId: 'member-1',
      lockedReportId: null,
    })

    const response = await entryRoute.POST(entryRequest('POST'))

    expect(response.status).toBe(200)
  })

  it('refuses someone else\'s project-less entry', async () => {
    mockFindOne.mockResolvedValue({
      id: ENTRY_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: null,
      staffMemberId: 'member-9',
      lockedReportId: null,
    })

    const response = await entryRoute.POST(entryRequest('POST'))

    expect(response.status).toBe(404)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('scopes the entry lookup by tenant and organization', async () => {
    await entryRoute.POST(entryRequest('POST'))

    expect(mockFindOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: ENTRY_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      }),
    )
  })

  it('surfaces the command 409 for an entry locked in a closed report', async () => {
    const { CrudHttpError } = await import('@open-mercato/shared/lib/crud/errors')
    mockExecute.mockRejectedValue(
      new CrudHttpError(409, { code: 'time_entry_locked', error: 'Locked', lockedReportId: 'report-1' }),
    )

    const response = await entryRoute.POST(entryRequest('POST'))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'time_entry_locked' })
  })

  it('rejects a body without a time entry id with 400', async () => {
    const response = await entryRoute.POST(entryRequest('POST', { tagIds: [TAG_ID] }))

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
