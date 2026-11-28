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
  unavailabilityReasonEntryId: string | null
  unavailabilityReasonValue: string | null
  note: string | null
  decisionComment: string | null
  submittedByUserId: string | null
  decidedByUserId: string | null
  decidedAt: Date | null
  deletedAt: Date | null
  updatedAt: Date
}

type CreatedRule = { id: string; rrule: string; kind: string; subjectId: string }

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const LEAVE_REQUEST_ID = '55555555-5555-4555-8555-555555555555'
const MEMBER_ID = '66666666-6666-4666-8666-666666666666'
const ORIGINAL_UPDATED_AT = new Date('2026-01-02T00:00:00.000Z')

function makeLeaveRequest(startDate: Date, endDate: Date): LeaveRequestFixture {
  return {
    id: LEAVE_REQUEST_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    member: { id: MEMBER_ID },
    startDate,
    endDate,
    timezone: 'UTC',
    status: 'pending',
    unavailabilityReasonEntryId: null,
    unavailabilityReasonValue: null,
    note: null,
    decisionComment: null,
    submittedByUserId: null,
    decidedByUserId: null,
    decidedAt: null,
    deletedAt: null,
    updatedAt: ORIGINAL_UPDATED_AT,
  }
}

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

function createCtx() {
  const createdRules: CreatedRule[] = []
  const trx = {
    create: jest.fn((_entity: unknown, data: CreatedRule) => {
      createdRules.push(data)
      return data
    }),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const em = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn(),
    find: jest.fn(async () => createdRules),
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (callback: (manager: typeof trx) => Promise<void>) => callback(trx)),
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
  return { ctx, em, trx, createdRules }
}

async function loadAcceptCommand(): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../leave-requests')
  return commandRegistry.get('staff.leave-requests.accept') as RegisteredCommand
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

describe('staff.leave-requests.accept refuses a range that blocks no days', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('refuses a stored request whose endDate is before its startDate', async () => {
    const request = makeLeaveRequest(utcDay('2026-06-20'), utcDay('2026-06-10'))
    mockFindOneWithDecryption.mockResolvedValue(request)
    const command = await loadAcceptCommand()
    const { ctx, em, trx } = createCtx()

    const error = await captureError(() => command.execute({ id: LEAVE_REQUEST_ID }, ctx))

    expect(error.status).toBe(400)
    expect(error.body.error).toBe('staff.leaveRequests.errors.invalidDateRange')
    expect(error.body.fieldErrors).toEqual({ endDate: 'staff.leaveRequests.errors.invalidDateRange' })
    expect(em.transactional).not.toHaveBeenCalled()
    expect(trx.create).not.toHaveBeenCalled()
    expect(trx.flush).not.toHaveBeenCalled()
    expect(request.status).toBe('pending')
    expect(request.decidedAt).toBeNull()
    expect(request.decidedByUserId).toBeNull()
    expect(request.updatedAt).toBe(ORIGINAL_UPDATED_AT)
  })

  it('refuses a stored request whose dates cannot produce any day', async () => {
    const request = makeLeaveRequest(new Date('invalid'), utcDay('2026-06-10'))
    mockFindOneWithDecryption.mockResolvedValue(request)
    const command = await loadAcceptCommand()
    const { ctx, em, trx } = createCtx()

    const error = await captureError(() => command.execute({ id: LEAVE_REQUEST_ID }, ctx))

    expect(error.status).toBe(400)
    expect(error.body.error).toBe('staff.leaveRequests.errors.invalidDateRange')
    expect(em.transactional).not.toHaveBeenCalled()
    expect(trx.create).not.toHaveBeenCalled()
    expect(request.status).toBe('pending')
  })

  it('approves an ordered range and blocks every day in it', async () => {
    const request = makeLeaveRequest(utcDay('2026-06-10'), utcDay('2026-06-12'))
    mockFindOneWithDecryption.mockResolvedValue(request)
    const command = await loadAcceptCommand()
    const { ctx, trx, createdRules } = createCtx()

    const result = (await command.execute({ id: LEAVE_REQUEST_ID }, ctx)) as { requestId: string; ruleIds: string[] }

    expect(request.status).toBe('approved')
    expect(request.decidedAt).toBeInstanceOf(Date)
    expect(trx.flush).toHaveBeenCalledTimes(1)
    expect(createdRules.map((rule) => rule.rrule.split('\n')[0])).toEqual([
      'DTSTART:20260610T000000Z',
      'DTSTART:20260611T000000Z',
      'DTSTART:20260612T000000Z',
    ])
    expect(createdRules.every((rule) => rule.kind === 'unavailability' && rule.subjectId === MEMBER_ID)).toBe(true)
    expect(result).toEqual({ requestId: LEAVE_REQUEST_ID, ruleIds: createdRules.map((rule) => rule.id) })
  })

  it('approves a single-day request where startDate equals endDate', async () => {
    const request = makeLeaveRequest(utcDay('2026-06-10'), utcDay('2026-06-10'))
    mockFindOneWithDecryption.mockResolvedValue(request)
    const command = await loadAcceptCommand()
    const { ctx, createdRules } = createCtx()

    await command.execute({ id: LEAVE_REQUEST_ID }, ctx)

    expect(request.status).toBe('approved')
    expect(createdRules).toHaveLength(1)
    expect(createdRules[0].rrule.split('\n')[0]).toBe('DTSTART:20260610T000000Z')
  })
})
