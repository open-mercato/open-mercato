/** @jest-environment node */
/**
 * The bulk-complete start route.
 *
 * Its whole job is to be safe about what it makes durable: the scope comes from
 * the session, every selected id is proven to be in that scope BEFORE anything is
 * written, and a repeated idempotency key must never produce a second logical
 * operation or a second progress job.
 */
// Every one of these must be hex-valid: the route parses `ids` and
// `idempotencyKey` with `z.string().uuid()`, so a placeholder containing a
// non-hex character would make every request 400 and quietly turn each
// assertion below into a test of the parse failure instead of the handler.
const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const ORG_A1 = '00000000-0000-4000-8000-0000000000a1'
const USER_A = '00000000-0000-4000-8000-0000000000b1'
const TODO_1 = '00000000-0000-4000-8000-0000000000c1'
const TODO_2 = '00000000-0000-4000-8000-0000000000c2'
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-0000000000d1'
const PROGRESS_JOB_ID = '00000000-0000-4000-8000-0000000000e1'
const OPERATION_ID = '00000000-0000-4000-8000-0000000000f1'

const mockAuth: { value: Record<string, unknown> | null } = { value: null }
const scopedTodoCount = { value: 2 }
const guardOutcome: { blocked: boolean } = { blocked: false }
const countCalls: Record<string, unknown>[] = []
const runAfterSuccess = jest.fn(async () => undefined)

const claimTodoBulkOperation = jest.fn(async () => ({
  operationId: OPERATION_ID,
  progressJobId: PROGRESS_JOB_ID,
  created: true,
}))
const publishTodoBulkOperation = jest.fn(async () => true)

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => mockAuth.value),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') {
        return {
          fork: () => ({
            count: async (_entity: unknown, filter: Record<string, unknown>) => {
              countCalls.push(filter)
              return scopedTodoCount.value
            },
          }),
        }
      }
      return {}
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn(async () => (guardOutcome.blocked
    ? {
      ok: false,
      errorStatus: 422,
      errorBody: { error: 'blocked' },
      response: Response.json({ error: 'blocked' }, { status: 422 }),
    }
    : { ok: true, runAfterSuccess })),
}))

jest.mock('../../lib/todoBulkComplete', () => {
  const actual = jest.requireActual('../../lib/todoBulkComplete')
  return {
    ...actual,
    claimTodoBulkOperation: (...args: unknown[]) => claimTodoBulkOperation(...(args as [])),
    publishTodoBulkOperation: (...args: unknown[]) => publishTodoBulkOperation(...(args as [])),
  }
})

import { POST, metadata } from '../todos/bulk-complete/route'

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/example/todos/bulk-complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('example todo bulk-complete route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    countCalls.length = 0
    scopedTodoCount.value = 2
    guardOutcome.blocked = false
    mockAuth.value = { sub: USER_A, tenantId: TENANT_A, orgId: ORG_A1 }
    claimTodoBulkOperation.mockResolvedValue({
      operationId: OPERATION_ID,
      progressJobId: PROGRESS_JOB_ID,
      created: true,
    })
  })

  it('uses fixtures the route schema actually accepts', () => {
    // Without this, a placeholder that is not hex-valid makes every request 400
    // and the negative assertions below pass for the wrong reason.
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    for (const value of [TENANT_A, ORG_A1, USER_A, TODO_1, TODO_2, IDEMPOTENCY_KEY, PROGRESS_JOB_ID, OPERATION_ID]) {
      expect(value).toMatch(uuidPattern)
    }
  })

  it('requires authentication and the todo manage feature', () => {
    expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['example.todos.manage'] })
  })

  it('returns 202 with the progress job id the DataTable contract needs', async () => {
    const response = await POST(buildRequest({ ids: [TODO_1, TODO_2], idempotencyKey: IDEMPOTENCY_KEY }))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      ok: true,
      progressJobId: PROGRESS_JOB_ID,
      message: 'Bulk completion started.',
    })
    expect(publishTodoBulkOperation).toHaveBeenCalledTimes(1)
  })

  it('derives the scope from the session, never from the request body', async () => {
    await POST(buildRequest({
      ids: [TODO_1, TODO_2],
      idempotencyKey: IDEMPOTENCY_KEY,
      tenantId: 'attacker-tenant',
      organizationId: 'attacker-org',
    }))

    expect(countCalls[0]).toMatchObject({ tenantId: TENANT_A, organizationId: ORG_A1 })
    expect(claimTodoBulkOperation).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: TENANT_A, organizationId: ORG_A1, userId: USER_A },
    }))
  })

  it('deduplicates repeated ids before anything durable is written', async () => {
    await POST(buildRequest({ ids: [TODO_1, TODO_1, TODO_2], idempotencyKey: IDEMPOTENCY_KEY }))

    expect(claimTodoBulkOperation).toHaveBeenCalledWith(expect.objectContaining({
      todoIds: [TODO_1, TODO_2],
    }))
  })

  it('creates neither an operation nor a progress job when an id is out of scope', async () => {
    scopedTodoCount.value = 1

    const response = await POST(buildRequest({ ids: [TODO_1, TODO_2], idempotencyKey: IDEMPOTENCY_KEY }))

    expect(response.status).toBe(404)
    expect(claimTodoBulkOperation).not.toHaveBeenCalled()
    expect(publishTodoBulkOperation).not.toHaveBeenCalled()
  })

  it('reports the existing progress job when the same idempotency key is replayed', async () => {
    claimTodoBulkOperation.mockResolvedValue({
      operationId: OPERATION_ID,
      progressJobId: PROGRESS_JOB_ID,
      created: false,
    })

    const response = await POST(buildRequest({ ids: [TODO_1, TODO_2], idempotencyKey: IDEMPOTENCY_KEY }))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      ok: true,
      progressJobId: PROGRESS_JOB_ID,
      message: 'Bulk completion already in progress.',
    })
  })

  it('returns the guard response and writes nothing when a mutation guard blocks the request', async () => {
    guardOutcome.blocked = true

    const response = await POST(buildRequest({ ids: [TODO_1], idempotencyKey: IDEMPOTENCY_KEY }))

    expect(response.status).toBe(422)
    expect(claimTodoBulkOperation).not.toHaveBeenCalled()
    expect(countCalls).toEqual([])
  })

  it('rejects an unauthenticated caller before touching the container', async () => {
    mockAuth.value = null

    const response = await POST(buildRequest({ ids: [TODO_1], idempotencyKey: IDEMPOTENCY_KEY }))

    expect(response.status).toBe(401)
    expect(claimTodoBulkOperation).not.toHaveBeenCalled()
  })

  it('requires an organization scope', async () => {
    mockAuth.value = { sub: USER_A, tenantId: TENANT_A, orgId: null }

    const response = await POST(buildRequest({ ids: [TODO_1], idempotencyKey: IDEMPOTENCY_KEY }))

    expect(response.status).toBe(400)
    expect(claimTodoBulkOperation).not.toHaveBeenCalled()
  })

  it.each([
    ['no ids', { ids: [], idempotencyKey: IDEMPOTENCY_KEY }],
    ['a non-uuid id', { ids: ['not-a-uuid'], idempotencyKey: IDEMPOTENCY_KEY }],
    ['a missing idempotency key', { ids: [TODO_1] }],
    ['more ids than the cap', {
      ids: Array.from({ length: 501 }, () => TODO_1),
      idempotencyKey: IDEMPOTENCY_KEY,
    }],
  ])('rejects a payload with %s', async (_label, body) => {
    const response = await POST(buildRequest(body))

    expect(response.status).toBe(400)
    expect(claimTodoBulkOperation).not.toHaveBeenCalled()
  })
})
