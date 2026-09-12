/** @jest-environment node */
// T2.12, second half: the PUT added for re-dating an assignment runs on the CRUD
// factory's command path, which is what wires the mutation-guard registry. These
// tests drive the real handler so a regression that hand-rolls the write (and
// silently loses guard enforcement) fails here: a blocking guard must stop the
// command from ever executing, and the guard must see the membership id.
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard, MutationGuardInput } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const MEMBERSHIP_ID = '77777777-7777-4777-8777-777777777777'

const mockCommandExecute = jest.fn()
const mockGetAuthFromRequest = jest.fn()

const container = {
  resolve: (token: string) => {
    if (token === 'commandBus') return { execute: mockCommandExecute }
    if (token === 'em') return { findOne: jest.fn(), find: jest.fn() }
    throw new Error(`[internal] ${token} is not registered in this test container`)
  },
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
  getAuthFromCookies: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

const guardCalls: MutationGuardInput[] = []
let guardBlocks = false

const testGuard: MutationGuard = {
  id: 'test.time-project-member-guard',
  targetEntity: '*',
  operations: ['create', 'update', 'delete'],
  async validate(input) {
    guardCalls.push(input)
    if (!guardBlocks) return { ok: true }
    return { ok: false, status: 423, message: 'Blocked by test guard' }
  },
}

function putRequest(body: Record<string, unknown>) {
  return new Request(`https://example.test/api/staff/timesheets/time-projects/${PROJECT_ID}/employees`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('staff time project employees PUT mutation guards (T2.12)', () => {
  let PUT: (request: Request) => Promise<Response>

  beforeAll(async () => {
    registerMutationGuards([{ moduleId: 'test', guards: [testGuard] }])
    PUT = (await import('../route')).PUT as unknown as (request: Request) => Promise<Response>
  })

  beforeEach(() => {
    jest.clearAllMocks()
    guardCalls.length = 0
    guardBlocks = false
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    mockCommandExecute.mockResolvedValue({ result: { timeProjectMemberId: MEMBERSHIP_ID }, logEntry: null })
  })

  it('rejects an unauthenticated caller before touching the command', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await PUT(putRequest({ id: MEMBERSHIP_ID, assignedEndDate: '2026-12-31' }))

    expect(response.status).toBe(401)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('runs the update command with the membership id and the project from the URL', async () => {
    const response = await PUT(putRequest({ id: MEMBERSHIP_ID, assignedEndDate: '2026-12-31' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ id: MEMBERSHIP_ID })
    expect(mockCommandExecute).toHaveBeenCalledTimes(1)
    const [commandId, payload] = mockCommandExecute.mock.calls[0]
    expect(commandId).toBe('staff.timesheets.time_project_members.update')
    expect(payload.input).toMatchObject({ id: MEMBERSHIP_ID, timeProjectId: PROJECT_ID })
  })

  it('passes the membership id to the guard so row-level guards can bind to it', async () => {
    await PUT(putRequest({ id: MEMBERSHIP_ID, assignedEndDate: '2026-12-31' }))

    expect(guardCalls).toHaveLength(1)
    expect(guardCalls[0]).toMatchObject({
      operation: 'update',
      resourceId: MEMBERSHIP_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('passes a guard rejection straight back to the caller and never runs the command', async () => {
    guardBlocks = true

    const response = await PUT(putRequest({ id: MEMBERSHIP_ID, assignedEndDate: '2026-12-31' }))

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toMatchObject({ error: 'Blocked by test guard' })
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })
})
