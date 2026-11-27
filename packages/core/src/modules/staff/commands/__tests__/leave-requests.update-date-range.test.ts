import type { AwilixContainer } from 'awilix'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string) => key,
  }),
}))

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

type HttpError = { status: number; body: Record<string, unknown> }

type LeaveRequestFixture = {
  id: string
  tenantId: string
  organizationId: string
  member: { id: string }
  startDate: Date
  endDate: Date
  timezone: string
  status: string
  note: string | null
  deletedAt: Date | null
  updatedAt: Date
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const LEAVE_REQUEST_ID = '55555555-5555-4555-8555-555555555555'
const MEMBER_ID = '66666666-6666-4666-8666-666666666666'

function makeLeaveRequest(startDate: string, endDate: string): LeaveRequestFixture {
  return {
    id: LEAVE_REQUEST_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    member: { id: MEMBER_ID },
    startDate: new Date(`${startDate}T00:00:00.000Z`),
    endDate: new Date(`${endDate}T00:00:00.000Z`),
    timezone: 'UTC',
    status: 'pending',
    note: null,
    deletedAt: null,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }
}

function createCtx() {
  const em = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const ctx = {
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: false },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return { indexSync: jest.fn() }
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
  }
  return { ctx, em }
}

async function loadUpdateCommand(): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../leave-requests')
  return commandRegistry.get('staff.leave-requests.update') as RegisteredCommand
}

async function captureError(run: () => Promise<unknown>): Promise<HttpError> {
  try {
    await run()
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && 'body' in err) return err as HttpError
    throw err
  }
  throw new Error('[internal] expected command to throw')
}

describe('staff.leave-requests.update keeps the merged date range ordered', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects a patch with only endDate that lands before the stored startDate', async () => {
    const request = makeLeaveRequest('2026-06-10', '2026-06-20')
    mockFindOneWithDecryption.mockResolvedValue(request)
    const command = await loadUpdateCommand()
    const { ctx, em } = createCtx()

    const error = await captureError(() => command.execute({ id: LEAVE_REQUEST_ID, endDate: '2026-06-01' }, ctx))

    expect(error.status).toBe(400)
    expect(error.body.error).toBe('staff.leaveRequests.errors.invalidDateRange')
    expect(error.body.fieldErrors).toEqual({ endDate: 'staff.leaveRequests.errors.invalidDateRange' })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a patch with only startDate that lands after the stored endDate', async () => {
    const request = makeLeaveRequest('2026-06-10', '2026-06-20')
    mockFindOneWithDecryption.mockResolvedValue(request)
    const command = await loadUpdateCommand()
    const { ctx, em } = createCtx()

    const error = await captureError(() => command.execute({ id: LEAVE_REQUEST_ID, startDate: '2026-06-25' }, ctx))

    expect(error.status).toBe(400)
    expect(error.body.error).toBe('staff.leaveRequests.errors.invalidDateRange')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('accepts a single-date patch that keeps the range ordered', async () => {
    const request = makeLeaveRequest('2026-06-10', '2026-06-20')
    mockFindOneWithDecryption.mockResolvedValue(request)
    const command = await loadUpdateCommand()
    const { ctx, em } = createCtx()

    await command.execute({ id: LEAVE_REQUEST_ID, endDate: '2026-06-10' }, ctx)

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(request.endDate.toISOString()).toBe('2026-06-10T00:00:00.000Z')
  })

  it('accepts a single-date patch that repairs an already inverted range', async () => {
    const request = makeLeaveRequest('2026-06-20', '2026-06-10')
    mockFindOneWithDecryption.mockResolvedValue(request)
    const command = await loadUpdateCommand()
    const { ctx, em } = createCtx()

    await command.execute({ id: LEAVE_REQUEST_ID, endDate: '2026-06-25' }, ctx)

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(request.endDate.toISOString()).toBe('2026-06-25T00:00:00.000Z')
  })

  it('does not block a patch that leaves both dates untouched', async () => {
    const request = makeLeaveRequest('2026-06-20', '2026-06-10')
    mockFindOneWithDecryption.mockResolvedValue(request)
    const command = await loadUpdateCommand()
    const { ctx, em } = createCtx()

    await command.execute({ id: LEAVE_REQUEST_ID, note: 'Updated note' }, ctx)

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(request.note).toBe('Updated note')
  })
})
