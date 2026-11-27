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

type HttpError = { status: number; body: unknown }

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const LEAVE_REQUEST_ID = '55555555-5555-4555-8555-555555555555'
const MEMBER_ID = '66666666-6666-4666-8666-666666666666'

const COMMAND_IDS = [
  'staff.leave-requests.update',
  'staff.leave-requests.delete',
  'staff.leave-requests.accept',
  'staff.leave-requests.reject',
] as const

function makeLeaveRequest(status: string): Record<string, unknown> {
  return {
    id: LEAVE_REQUEST_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    member: { id: MEMBER_ID },
    startDate: new Date('2026-01-10T00:00:00.000Z'),
    endDate: new Date('2026-01-11T00:00:00.000Z'),
    timezone: 'UTC',
    status,
    unavailabilityReasonEntryId: null,
    unavailabilityReasonValue: null,
    note: null,
    decisionComment: null,
    submittedByUserId: null,
    decidedByUserId: null,
    decidedAt: null,
    deletedAt: null,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }
}

function createCtx() {
  const em = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (cb: (trx: unknown) => Promise<void>) => cb({})),
  }
  return {
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: false },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return { indexSync: jest.fn() }
        if (name === 'rbacService') return { userHasAllFeatures: jest.fn().mockResolvedValue(true) }
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
  }
}

async function loadCommand(id: (typeof COMMAND_IDS)[number]): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../leave-requests')
  return commandRegistry.get(id) as RegisteredCommand
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

describe('leave-request command errors are translated', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each(COMMAND_IDS)('%s returns the translated not-found error for a missing request', async (commandId) => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const command = await loadCommand(commandId)

    const error = await captureError(() => command.execute({ id: LEAVE_REQUEST_ID }, createCtx()))

    expect(error.status).toBe(404)
    expect(error.body).toEqual({ error: 'staff.leaveRequests.errors.notFound' })
  })

  it.each(COMMAND_IDS)('%s returns the translated already-finalized error for a decided request', async (commandId) => {
    mockFindOneWithDecryption.mockResolvedValue(makeLeaveRequest('approved'))
    const command = await loadCommand(commandId)

    const error = await captureError(() => command.execute({ id: LEAVE_REQUEST_ID }, createCtx()))

    expect(error.status).toBe(400)
    expect(error.body).toEqual({ error: 'staff.leaveRequests.errors.alreadyFinalized' })
  })
})
