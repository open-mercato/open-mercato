/** @jest-environment node */
// Coverage for issue #2609: `POST .../time-entries/{id}/timer-stop` used to write
// the entry directly through the ORM, which never invalidated the opt-in CRUD
// list cache and left stopped timers rendering as running. The route now
// delegates to the `staff.timesheets.time_entries.stop_timer` command, so cache
// invalidation, audit logging and undo come from the command bus. This test pins
// the route's half of that contract: the delegation itself, the mutation-guard
// wiring that `packages/core/AGENTS.md` requires for custom write routes, the
// response body, and the error-status mapping.
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockExecute = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunStaffMutationGuardAfterSuccess = jest.fn()

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'commandBus') return { execute: mockExecute }
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    features: ['staff.timesheets.manage_own'],
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId: TENANT_ID,
    selectedId: ORG_ID,
    filterIds: [ORG_ID],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('@open-mercato/core/modules/staff/api/guards', () => ({
  STAFF_TIME_TRACKING_RESOURCE_KINDS: { timeEntry: 'staff.timesheets.time_entry' },
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) =>
    mockRunStaffMutationGuardAfterSuccess(...args),
  ),
}))

function request() {
  return new Request(`http://localhost/api/staff/timesheets/time-entries/${ENTRY_ID}/timer-stop`, {
    method: 'POST',
  })
}

function successfulExecution(durationMinutes = 90) {
  return {
    result: { timeEntryId: ENTRY_ID, durationMinutes },
    logEntry: {
      id: 'log-1',
      undoToken: 'undo-token-1',
      commandId: 'staff.timesheets.time_entries.stop_timer',
      actionLabel: 'Stop timer',
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: ENTRY_ID,
      createdAt: new Date('2026-07-29T18:05:33.289Z'),
    },
  }
}

describe('timer-stop route delegation (#2609)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    mockRunStaffMutationGuardAfterSuccess.mockResolvedValue(undefined)
    mockExecute.mockResolvedValue(successfulExecution())
  })

  test('delegates to the stop_timer command with the scoped input and returns durationMinutes', async () => {
    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(request())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, durationMinutes: 90 })
    expect(mockExecute).toHaveBeenCalledTimes(1)
    const [commandId, args] = mockExecute.mock.calls[0] as [string, { input: Record<string, unknown> }]
    // The `staff.timesheets.time_entries.*` prefix is load-bearing: the command
    // bus derives the `staff.timesheet` cache alias from it, which is what makes
    // the invalidation tags line up with the cached list payload.
    expect(commandId).toBe('staff.timesheets.time_entries.stop_timer')
    // The entry id comes from the URL, not the body.
    expect(args.input).toMatchObject({ id: ENTRY_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  test('emits the x-om-operation undo header on success', async () => {
    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(request())

    const header = res.headers.get('x-om-operation')
    expect(header).toBeTruthy()
    expect(header).toContain('undo-token-1')
  })

  test('runs the mutation guards before the command and never executes when blocked', async () => {
    mockRunStaffMutationGuards.mockResolvedValue({
      ok: false,
      errorBody: { error: 'Blocked by policy' },
      errorStatus: 423,
      afterSuccessCallbacks: [],
    })

    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(request())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(423)
    expect(body).toEqual({ error: 'Blocked by policy' })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  test('falls back to 422 when a blocking guard supplies no status', async () => {
    mockRunStaffMutationGuards.mockResolvedValue({ ok: false, afterSuccessCallbacks: [] })

    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(request())

    expect(res.status).toBe(422)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  test('runs afterSuccess guard callbacks once the command succeeds', async () => {
    const callback = { guard: { afterSuccess: jest.fn() } }
    mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [callback] })

    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(mockRunStaffMutationGuardAfterSuccess).toHaveBeenCalledWith(
      [callback],
      expect.objectContaining({ resourceId: ENTRY_ID, operation: 'update' }),
    )
  })

  test.each([
    [404, 'Time entry not found.'],
    [403, 'You can only manage your own time entries.'],
    [409, 'No active timer segment found for this entry.'],
  ])('propagates the command %i error verbatim', async (status, message) => {
    mockExecute.mockRejectedValue(new CrudHttpError(status, { error: message }))

    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(request())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(status)
    expect(body).toEqual({ error: message })
  })

  test('maps an unexpected command failure to 400', async () => {
    mockExecute.mockRejectedValue(new Error('boom'))

    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(request())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'Failed to stop timer.' })
  })
})
