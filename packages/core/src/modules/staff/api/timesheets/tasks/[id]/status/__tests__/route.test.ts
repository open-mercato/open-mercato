/** @jest-environment node */
// Route-level coverage for the board drag (US-C2). The move itself is the command's
// business; what this endpoint owes the board is: the caller holds
// `staff.timesheets.tasks.manage`, the task belongs to a project they can actually
// see (and a caller who cannot see it learns nothing from the body), the mutation
// guard registry is wired the same way every hand-written staff write wires it, and
// the command's 409 reaches the client intact so the card can roll back.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()
const mockGetGrantedFeatures = jest.fn()
const mockResolveListProjectAccess = jest.fn()
const mockFindOne = jest.fn()

const mockEm = {
  fork: jest.fn(() => mockEm),
  findOne: jest.fn((...args: unknown[]) => mockFindOne(...args)),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'rbacService') return {
      getGrantedFeatures: mockGetGrantedFeatures,
      // Answers from the same grants the fake already carries, so a test that
      // grants a feature still grants it once the code asks the service.
      userHasAllFeatures: async (_u: string, required: string[]) => {
        const granted = (await mockGetGrantedFeatures()) ?? []
        return required.every((feature: string) =>
          granted.some((grant: string) =>
            grant === '*' || grant === feature || (grant.endsWith('.*') && feature.startsWith(grant.slice(0, -1))),
          ),
        )
      },
    }
    if (token === 'em') return mockEm
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

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn((args: unknown) => mockRunRouteMutationGuards(args)),
}))

// The access decision is the tasks list route's, memoised per request — this route
// reuses it rather than resolving membership a second way.
jest.mock('../../../route', () => ({
  resolveListProjectAccess: jest.fn((ctx: unknown) => mockResolveListProjectAccess(ctx)),
}))

const TASK_ID = '77777777-7777-4777-8777-777777777777'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const BACKLOG_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PROGRESS_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const MANAGE_FEATURE = 'staff.timesheets.tasks.manage'
const NOT_FOUND_BODY = { error: 'Task not found or not accessible.' }

type RouteModule = typeof import('../route')
let patchHandler: RouteModule['PATCH']

beforeAll(async () => {
  patchHandler = (await import('../route')).PATCH
})

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/staff/timesheets/tasks/${TASK_ID}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('staff timesheets task status route (US-C2)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: [MANAGE_FEATURE],
    })
    mockResolveOrganizationScope.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: 'org-1',
      filterIds: ['org-1'],
    })
    mockGetGrantedFeatures.mockResolvedValue([MANAGE_FEATURE])
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
    mockFindOne.mockResolvedValue({ id: TASK_ID, timeProjectId: PROJECT_ID })
    mockResolveListProjectAccess.mockResolvedValue({
      canManageAll: false,
      projectIds: [PROJECT_ID],
      staffMemberId: 'member-1',
    })
    mockExecute.mockResolvedValue({
      result: {
        taskId: TASK_ID,
        timeProjectId: PROJECT_ID,
        previousTaskStatusId: BACKLOG_ID,
        taskStatusId: PROGRESS_ID,
        position: 1500,
        closedAt: null,
        updatedAt: '2026-08-12T09:00:00.000Z',
      },
      logEntry: null,
    })
  })

  it('moves the card and answers with the new column, slot and version', async () => {
    const response = await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID, position: 1500 }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      id: TASK_ID,
      timeProjectId: PROJECT_ID,
      previousTaskStatusId: BACKLOG_ID,
      taskStatusId: PROGRESS_ID,
      position: 1500,
      closedAt: null,
      updatedAt: '2026-08-12T09:00:00.000Z',
    })
    expect(mockExecute).toHaveBeenCalledWith(
      'staff.timesheets.tasks.status_change',
      expect.objectContaining({
        input: { id: TASK_ID, taskStatusId: PROGRESS_ID, position: 1500 },
      }),
    )
    expect(mockRunAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('forwards a body without a position untouched, which is the subtask tick', async () => {
    await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID }))

    expect(mockExecute).toHaveBeenCalledWith(
      'staff.timesheets.tasks.status_change',
      expect.objectContaining({ input: { id: TASK_ID, taskStatusId: PROGRESS_ID } }),
    )
  })

  it('passes the request to the command so the optimistic-lock header is read', async () => {
    const request = buildRequest(
      { taskStatusId: PROGRESS_ID },
      { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-08-12T08:00:00.000Z' },
    )

    await patchHandler(request)

    const [, payload] = mockExecute.mock.calls[0] as [string, { ctx: { request?: Request } }]
    expect(payload.ctx.request).toBe(request)
  })

  it('gives a non-member the same 404 a missing task gets', async () => {
    mockResolveListProjectAccess.mockResolvedValue({
      canManageAll: false,
      projectIds: ['99999999-9999-4999-8999-999999999999'],
      staffMemberId: 'member-2',
    })

    const response = await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID }))
    const body = await response.json()

    expect(response.status).toBe(404)
    // Nothing in the answer confirms the task, its project or its board exist.
    expect(body).toEqual(NOT_FOUND_BODY)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunRouteMutationGuards).not.toHaveBeenCalled()
  })

  it('answers 404 with that same body when the task does not exist', async () => {
    mockFindOne.mockResolvedValue(null)

    const response = await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual(NOT_FOUND_BODY)
    expect(mockResolveListProjectAccess).not.toHaveBeenCalled()
  })

  it('scopes the task lookup to the caller tenant and organization', async () => {
    await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID }))

    expect(mockFindOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: TASK_ID, tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null }),
    )
  })

  it('lets a manager move a card on any project', async () => {
    mockResolveListProjectAccess.mockResolvedValue({ canManageAll: true, projectIds: [], staffMemberId: null })

    const response = await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID }))

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('rejects a caller without staff.timesheets.tasks.manage with 403', async () => {
    mockGetGrantedFeatures.mockResolvedValue(['staff.timesheets.tasks.view'])

    const response = await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID }))

    expect(response.status).toBe(403)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects a body without a target column with 400', async () => {
    const response = await patchHandler(buildRequest({ position: 1500 }))

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('wires the mutation guard registry and stops on a blocked mutation', async () => {
    const blockedResponse = Response.json({ error: 'Locked' }, { status: 423 })
    mockRunRouteMutationGuards.mockResolvedValueOnce({ ok: false, response: blockedResponse })

    const response = await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID, position: 1500 }))

    expect(response.status).toBe(423)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(
      expect.objectContaining({
        container: mockContainer,
        auth: expect.objectContaining({
          userId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          userFeatures: [MANAGE_FEATURE],
        }),
        input: expect.objectContaining({
          resourceKind: 'staff.timesheets.time_task',
          resourceId: TASK_ID,
          operation: 'update',
          mutationPayload: { taskStatusId: PROGRESS_ID, position: 1500 },
        }),
      }),
    )
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('surfaces the command 409 so the board can roll the card back', async () => {
    const { CrudHttpError } = await import('@open-mercato/shared/lib/crud/errors')
    mockExecute.mockRejectedValueOnce(
      new CrudHttpError(409, {
        error: 'record_modified',
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: '2026-08-12T09:00:00.000Z',
        expectedUpdatedAt: '2026-08-12T08:00:00.000Z',
      }),
    )

    const response = await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID, position: 1500 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: '2026-08-12T09:00:00.000Z',
      expectedUpdatedAt: '2026-08-12T08:00:00.000Z',
    })
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })

  it('surfaces the command 422 for a column from another project', async () => {
    const { CrudHttpError } = await import('@open-mercato/shared/lib/crud/errors')
    mockExecute.mockRejectedValueOnce(
      new CrudHttpError(422, {
        error: 'That column does not belong to this project.',
        fieldErrors: { taskStatusId: 'That column does not belong to this project.' },
      }),
    )

    const response = await patchHandler(buildRequest({ taskStatusId: BACKLOG_ID }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      fieldErrors: { taskStatusId: expect.any(String) },
    })
  })

  it('rejects an unauthenticated caller with 401', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await patchHandler(buildRequest({ taskStatusId: PROGRESS_ID }))

    expect(response.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
