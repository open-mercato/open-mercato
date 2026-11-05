/** @jest-environment node */
// T3.4b route coverage. The thread endpoint has one property it must never lose:
// a caller who cannot see the task's project learns nothing about the task —
// the refusal is the SAME 404 body, byte for byte, that a task id which does not
// exist produces. The rest of the cases are the thread's own contract: oldest
// first, soft-deleted comments gone from the list, the author never taken from
// the payload, and every read scoped to the caller's tenant and organization.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockResolveProjectAccess = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()
const mockFindWithDecryption = jest.fn()

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const VISIBLE_PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const HIDDEN_PROJECT_ID = '44444444-4444-4444-8444-4444444444ff'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_TASK_ID = '66666666-6666-4666-8666-6666666666ff'
const CALLER_USER_ID = '99999999-9999-4999-8999-999999999999'
const SPOOFED_USER_ID = '99999999-9999-4999-8999-9999999999ff'
const FIRST_COMMENT_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
const SECOND_COMMENT_ID = 'bbbbbbbb-0000-4000-8000-000000000002'
const DELETED_COMMENT_ID = 'bbbbbbbb-0000-4000-8000-000000000003'
const FOREIGN_COMMENT_ID = 'bbbbbbbb-0000-4000-8000-0000000000ff'

type Row = Record<string, unknown>

const tables: { tasks: Row[]; comments: Row[] } = { tasks: [], comments: [] }

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    const operators = expected as Record<string, unknown>
    if ('$in' in operators) return (operators.$in as unknown[]).includes(actual)
  }
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => matchesValue(row[key], expected))
}

function tableFor(className: string): Row[] {
  if (className === 'StaffTimeTask') return tables.tasks
  if (className === 'StaffTimeTaskComment') return tables.comments
  return []
}

const findAndCountCalls: Array<{ where: Row; options: Record<string, unknown> }> = []

const mockEm = {
  fork: jest.fn(() => mockEm),
  findOne: jest.fn(async (cls: { name: string }, where: Row) => tableFor(cls.name).find((row) => matches(row, where)) ?? null),
  findAndCount: jest.fn(async (cls: { name: string }, where: Row, options: Record<string, unknown> = {}) => {
    findAndCountCalls.push({ where, options })
    const rows = tableFor(cls.name).filter((row) => matches(row, where))
    const orderBy = (options.orderBy ?? {}) as Record<string, string>
    if (orderBy.createdAt) {
      const dir = orderBy.createdAt === 'desc' ? -1 : 1
      rows.sort(
        (left, right) =>
          dir * ((left.createdAt as Date).getTime() - (right.createdAt as Date).getTime()),
      )
    }
    const offset = typeof options.offset === 'number' ? options.offset : 0
    const limit = typeof options.limit === 'number' ? options.limit : rows.length
    return [rows.slice(offset, offset + limit), rows.length]
  }),
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

jest.mock('../../../../../../lib/time-tracking/access', () => ({
  resolveProjectAccess: jest.fn((args: unknown) => mockResolveProjectAccess(args)),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn((args: unknown) => mockRunRouteMutationGuards(args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

type CommentsRoute = typeof import('../route')

let route: CommentsRoute

beforeAll(async () => {
  route = await import('../route')
})

function url(taskId: string = TASK_ID, search = ''): string {
  return `http://localhost/api/staff/timesheets/tasks/${taskId}/comments${search}`
}

function request(method: string, body?: unknown, taskId: string = TASK_ID, search = ''): Request {
  return new Request(url(taskId, search), {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function seedComments(): void {
  tables.comments.push(
    {
      id: SECOND_COMMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      taskId: TASK_ID,
      body: 'Poprawione, testy przechodzą.',
      authorUserId: SPOOFED_USER_ID,
      createdAt: new Date('2026-07-18T09:05:00.000Z'),
      updatedAt: new Date('2026-07-18T09:05:00.000Z'),
      deletedAt: null,
    },
    {
      id: FIRST_COMMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      taskId: TASK_ID,
      body: 'Klient prosi o rabaty od ceny netto.',
      authorUserId: CALLER_USER_ID,
      createdAt: new Date('2026-07-17T14:22:00.000Z'),
      updatedAt: new Date('2026-07-17T14:22:00.000Z'),
      deletedAt: null,
    },
    {
      id: DELETED_COMMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      taskId: TASK_ID,
      body: 'Usunięty komentarz.',
      authorUserId: CALLER_USER_ID,
      createdAt: new Date('2026-07-19T09:05:00.000Z'),
      updatedAt: new Date('2026-07-19T09:05:00.000Z'),
      deletedAt: new Date('2026-07-19T10:00:00.000Z'),
    },
    {
      id: FOREIGN_COMMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      taskId: OTHER_TASK_ID,
      body: 'Komentarz innego zadania.',
      authorUserId: CALLER_USER_ID,
      createdAt: new Date('2026-07-20T09:05:00.000Z'),
      updatedAt: new Date('2026-07-20T09:05:00.000Z'),
      deletedAt: null,
    },
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  tables.tasks = [
    { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: VISIBLE_PROJECT_ID, deletedAt: null },
    {
      id: OTHER_TASK_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: VISIBLE_PROJECT_ID,
      deletedAt: null,
    },
  ]
  tables.comments = []
  findAndCountCalls.length = 0
  mockGetAuthFromRequest.mockResolvedValue({
    sub: CALLER_USER_ID,
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
  mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
  mockRunAfterSuccess.mockResolvedValue(undefined)
  mockFindWithDecryption.mockResolvedValue([
    { id: CALLER_USER_ID, name: 'Marek Wójcik', email: 'marek@example.com' },
    { id: SPOOFED_USER_ID, name: 'Anna Nowak', email: 'anna@example.com' },
  ])
  mockExecute.mockResolvedValue({
    result: { commentId: FIRST_COMMENT_ID, taskId: TASK_ID, authorUserId: CALLER_USER_ID },
    logEntry: null,
  })
})

describe('task comments — list', () => {
  it('returns the thread oldest-first with author display names resolved', async () => {
    seedComments()

    const response = await route.GET(request('GET'))
    const payload = (await response.json()) as {
      items: Array<{ id: string; authorName: string | null; body: string }>
      total: number
    }

    expect(response.status).toBe(200)
    expect(payload.items.map((item) => item.id)).toEqual([FIRST_COMMENT_ID, SECOND_COMMENT_ID])
    expect(payload.items[0].authorName).toBe('Marek Wójcik')
    expect(payload.items[1].authorName).toBe('Anna Nowak')
    expect(payload.total).toBe(2)
  })

  it('hides soft-deleted comments while the row itself survives', async () => {
    seedComments()

    const response = await route.GET(request('GET'))
    const payload = (await response.json()) as { items: Array<{ id: string }> }

    expect(payload.items.map((item) => item.id)).not.toContain(DELETED_COMMENT_ID)
    expect(tables.comments.some((row) => row.id === DELETED_COMMENT_ID)).toBe(true)
  })

  it('scopes the thread to the caller tenant, organization and task', async () => {
    seedComments()

    await route.GET(request('GET'))

    expect(findAndCountCalls[0].where).toMatchObject({
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
    })
    expect(findAndCountCalls[0].options.orderBy).toEqual({ createdAt: 'asc', id: 'asc' })
  })

  it('does not leak another task\'s comments', async () => {
    seedComments()

    const response = await route.GET(request('GET'))
    const payload = (await response.json()) as { items: Array<{ id: string }> }

    expect(payload.items.map((item) => item.id)).not.toContain(FOREIGN_COMMENT_ID)
  })
})

describe('task comments — access refusal is indistinguishable from a missing task', () => {
  it('answers a task on an invisible project and a task that does not exist with the identical 404 body', async () => {
    tables.tasks = [
      { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: HIDDEN_PROJECT_ID, deletedAt: null },
    ]
    const deniedResponse = await route.GET(request('GET'))
    const deniedBody = await deniedResponse.text()

    tables.tasks = []
    const missingResponse = await route.GET(request('GET'))
    const missingBody = await missingResponse.text()

    expect(deniedResponse.status).toBe(404)
    expect(missingResponse.status).toBe(404)
    expect(deniedBody).toBe(missingBody)
  })

  it('applies the same parity to a write, before any command runs', async () => {
    tables.tasks = [
      { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: HIDDEN_PROJECT_ID, deletedAt: null },
    ]
    const deniedResponse = await route.POST(request('POST', { body: 'Nowy komentarz.' }))
    const deniedBody = await deniedResponse.text()

    tables.tasks = []
    const missingResponse = await route.POST(request('POST', { body: 'Nowy komentarz.' }))
    const missingBody = await missingResponse.text()

    expect(deniedResponse.status).toBe(404)
    expect(deniedBody).toBe(missingBody)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunRouteMutationGuards).not.toHaveBeenCalled()
  })

  it('refuses a task in another tenant even when its project is visible', async () => {
    tables.tasks = [
      {
        id: TASK_ID,
        tenantId: '11111111-1111-4111-8111-1111111111ff',
        organizationId: ORG_ID,
        timeProjectId: VISIBLE_PROJECT_ID,
        deletedAt: null,
      },
    ]

    const response = await route.GET(request('GET'))

    expect(response.status).toBe(404)
  })

  it('lets a manager through for a project they are not a member of', async () => {
    mockResolveProjectAccess.mockResolvedValue({ canManageAll: true, projectIds: [], staffMemberId: null })
    tables.tasks = [
      { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: HIDDEN_PROJECT_ID, deletedAt: null },
    ]

    const response = await route.GET(request('GET'))

    expect(response.status).toBe(200)
  })
})

describe('task comments — create', () => {
  it('never forwards a client-supplied authorUserId to the command', async () => {
    const response = await route.POST(
      request('POST', { body: 'Nowy komentarz.', authorUserId: SPOOFED_USER_ID }),
    )

    expect(response.status).toBe(201)
    expect(mockExecute).toHaveBeenCalledWith(
      'staff.timesheets.task_comments.create',
      expect.objectContaining({
        input: expect.objectContaining({ taskId: TASK_ID, body: 'Nowy komentarz.' }),
      }),
    )
    const [, call] = mockExecute.mock.calls[0] as [string, { input: Record<string, unknown> }]
    expect(call.input.authorUserId).toBeUndefined()
  })

  it('runs the mutation guards before the command', async () => {
    mockRunRouteMutationGuards.mockResolvedValue({
      ok: false,
      errorStatus: 423,
      errorBody: { error: 'Blocked' },
      response: Response.json({ error: 'Blocked' }, { status: 423 }),
    })

    const response = await route.POST(request('POST', { body: 'Nowy komentarz.' }))

    expect(response.status).toBe(423)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects an empty body with 400', async () => {
    const response = await route.POST(request('POST', { body: '   ' }))

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('task comments — update and delete', () => {
  it('routes an edit to the update command', async () => {
    seedComments()
    mockExecute.mockResolvedValue({ result: { commentId: FIRST_COMMENT_ID, taskId: TASK_ID }, logEntry: null })

    const response = await route.PUT(request('PUT', { id: FIRST_COMMENT_ID, body: 'Zmienione.' }))

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledWith(
      'staff.timesheets.task_comments.update',
      expect.objectContaining({ input: { id: FIRST_COMMENT_ID, body: 'Zmienione.' } }),
    )
  })

  it('refuses a comment addressed through another task\'s url', async () => {
    seedComments()

    const response = await route.PUT(request('PUT', { id: FOREIGN_COMMENT_ID, body: 'Zmienione.' }))

    expect(response.status).toBe(404)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('refuses an already soft-deleted comment', async () => {
    seedComments()

    const response = await route.DELETE(request('DELETE', { id: DELETED_COMMENT_ID }))

    expect(response.status).toBe(404)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('routes a delete to the delete command', async () => {
    seedComments()
    mockExecute.mockResolvedValue({ result: { commentId: FIRST_COMMENT_ID, taskId: TASK_ID }, logEntry: null })

    const response = await route.DELETE(request('DELETE', undefined, TASK_ID, `?id=${FIRST_COMMENT_ID}`))

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledWith(
      'staff.timesheets.task_comments.delete',
      expect.objectContaining({ input: { id: FIRST_COMMENT_ID } }),
    )
  })
})
