import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { WarrantyClaim } from '../data/entities'
import type { TransitionClaimInput } from '../data/validators'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const SHIPMENT_ID = '33333333-3333-4333-8333-333333333333'
const CLAIM_ID = '44444444-4444-4444-8444-444444444444'
const CLAIM_TWO_ID = '55555555-5555-4555-8555-555555555555'
const TRACKING_NUMBER = 'RETURN-TRACK-123'
const SYSTEM_NOTE = 'warranty_claims.timeline.autoReceivedFromTracking'
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const mockLoggerDebug = jest.fn<void, [string, Record<string, unknown>?]>()
const mockLoggerWarn = jest.fn<void, [string, Record<string, unknown>?]>()
const mockLoggerError = jest.fn<void, [string, Record<string, unknown>?]>()
const mockLogger = {
  debug: mockLoggerDebug,
  info: jest.fn<void, [string, Record<string, unknown>?]>(),
  warn: mockLoggerWarn,
  error: mockLoggerError,
  child: jest.fn(),
}
mockLogger.child.mockReturnValue(mockLogger)

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => mockLogger,
}))

let mockTransitionClaim: WarrantyClaim | null = null
let mockTimelineEvents: Array<Record<string, unknown>> = []

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async () => mockTransitionClaim,
  findWithDecryption: async () => [],
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: async () => undefined,
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('../lib/settings', () => ({
  resolveEffectiveWarrantyClaimSettings: async () => ({
    slaHours: 48,
    slaPauseOnInfoRequested: true,
    slaAtRiskThresholdPct: 75,
    autoApproveEnabled: false,
    autoApproveMaxAmount: null,
    autoApproveCurrencyCode: null,
    autoApproveRequireInWarranty: true,
    defaultWarrantyMonths: null,
    businessHours: null,
    escalationTiers: null,
    adjudicationUseRules: false,
    quarantineGrades: null,
    returnLabelProvider: null,
  }),
}))

jest.mock('../events', () => ({
  emitWarrantyClaimsEvent: async () => undefined,
}))

import handle, { metadata } from '../subscribers/return-shipment-tracking'
import { transitionClaimCommand } from '../commands/claims'
import { transitionClaimInputSchema } from '../data/validators'

type ShipmentRow = {
  tracking_number: string | null
}

type ClaimRow = {
  id: string
  claim_number: string
  updated_at: Date | null
}

type QueryCall = {
  table: string
  selects: unknown[]
  wheres: Array<[string, string, unknown]>
  limit: number | null
}

type SubscriberDbOptions = {
  shipmentRow?: ShipmentRow | null
  claims?: ClaimRow[]
  shipmentError?: unknown
  claimError?: unknown
}

type CommandExecuteResult = Promise<{ result: { claimId: string }; logEntry: null }>
type CommandExecuteArgs = [string, { input: TransitionClaimInput; ctx: CommandRuntimeContext }]

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shipmentId: SHIPMENT_ID,
    providerKey: 'test-carrier',
    previousStatus: 'in_transit',
    newStatus: 'delivered',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    ...overrides,
  }
}

function makeSubscriberDatabase(options: SubscriberDbOptions = {}) {
  const calls: QueryCall[] = []
  const shipmentRow = options.shipmentRow === undefined
    ? { tracking_number: TRACKING_NUMBER }
    : options.shipmentRow
  const claims = options.claims ?? [{ id: CLAIM_ID, claim_number: 'WTY-000001', updated_at: new Date() }]
  const db = {
    selectFrom: (table: string) => {
      const call: QueryCall = { table, selects: [], wheres: [], limit: null }
      calls.push(call)
      const builder = {
        select: (selection: unknown) => {
          call.selects.push(selection)
          return builder
        },
        where: (column: string, operator: string, value: unknown) => {
          call.wheres.push([column, operator, value])
          return builder
        },
        limit: (value: number) => {
          call.limit = value
          return builder
        },
        executeTakeFirst: async () => {
          if (table !== 'carrier_shipments') throw new Error(`Unexpected executeTakeFirst table: ${table}`)
          if (options.shipmentError) throw options.shipmentError
          return shipmentRow ?? undefined
        },
        execute: async () => {
          if (table !== 'warranty_claims') throw new Error(`Unexpected execute table: ${table}`)
          if (options.claimError) throw options.claimError
          return claims.slice(0, call.limit ?? claims.length)
        },
      }
      return builder
    },
  }
  return { db, calls }
}

function makeSubscriberContext(options: SubscriberDbOptions = {}) {
  const { db, calls } = makeSubscriberDatabase(options)
  const fork = { getKysely: () => db }
  const em = { fork: () => fork } as unknown as EntityManager
  const execute = jest.fn<CommandExecuteResult, CommandExecuteArgs>(async (_commandId, command) => ({
    result: { claimId: command.input.id },
    logEntry: null,
  }))
  const commandBus = { execute }
  const context = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'commandBus') return commandBus as T
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
  return { calls, context, execute }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function makeTransitionCommandContext(): CommandRuntimeContext {
  const fork = {
    create: (_entity: unknown, data: Record<string, unknown>) => data,
    persist: (entity: unknown) => {
      const record = toRecord(entity)
      if (record.kind === 'status_changed') mockTimelineEvents.push(record)
    },
    getKysely: () => {
      const builder = {
        select: () => builder,
        where: () => builder,
        limit: () => builder,
        execute: async () => [],
      }
      return { selectFrom: () => builder }
    },
  }
  const em = { fork: () => fork } as unknown as EntityManager
  const dataEngine = { markOrmEntityChange: jest.fn() }
  return {
    container: {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return em as T
        if (name === 'dataEngine') return dataEngine as T
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: SYSTEM_USER_ID,
      tenantId: TENANT_ID,
      orgId: ORG_ID,
    },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    systemActor: true,
  }
}

beforeEach(() => {
  mockLoggerDebug.mockReset()
  mockLoggerWarn.mockReset()
  mockLoggerError.mockReset()
  mockTransitionClaim = null
  mockTimelineEvents = []
})

describe('warranty claim return-shipment tracking subscriber', () => {
  test('declares the persistent delivered-event subscription', () => {
    expect(metadata).toEqual({
      event: 'shipping_carriers.shipment.delivered',
      persistent: true,
      id: 'warranty_claims:return-shipment-tracking',
    })
  })

  test('skips an incomplete delivered payload even when subscriber context carries scope', async () => {
    const { calls, context, execute } = makeSubscriberContext()

    await handle(makePayload({ tenantId: undefined }), context)

    expect(calls).toHaveLength(0)
    expect(execute).not.toHaveBeenCalled()
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      expect.stringContaining('skipped incomplete delivered payload'),
      expect.objectContaining({ hasTenantId: false }),
    )
  })

  test('dispatches a received transition with the tracking system note for one matching claim', async () => {
    const { calls, context, execute } = makeSubscriberContext()

    await handle(makePayload(), context)

    expect(calls).toEqual([
      {
        table: 'carrier_shipments',
        selects: ['tracking_number'],
        wheres: [
          ['id', '=', SHIPMENT_ID],
          ['tenant_id', '=', TENANT_ID],
          ['organization_id', '=', ORG_ID],
          ['deleted_at', 'is', null],
        ],
        limit: null,
      },
      {
        table: 'warranty_claims',
        selects: [['id', 'claim_number', 'updated_at']],
        wheres: [
          ['tenant_id', '=', TENANT_ID],
          ['organization_id', '=', ORG_ID],
          ['deleted_at', 'is', null],
          ['status', '=', 'awaiting_return'],
          ['return_tracking_number', '=', TRACKING_NUMBER],
        ],
        limit: 2,
      },
    ])
    expect(execute).toHaveBeenCalledWith('warranty_claims.claim.transition', {
      input: {
        id: CLAIM_ID,
        toStatus: 'received',
        systemNote: SYSTEM_NOTE,
      },
      ctx: expect.objectContaining({
        auth: { sub: SYSTEM_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
        selectedOrganizationId: ORG_ID,
        organizationIds: [ORG_ID],
        systemActor: true,
      }),
    })
  })

  test('warns and skips when multiple claims match the tracking number', async () => {
    const claims = [
      { id: CLAIM_ID, claim_number: 'WTY-000001', updated_at: new Date() },
      { id: CLAIM_TWO_ID, claim_number: 'WTY-000002', updated_at: new Date() },
    ]
    const { context, execute } = makeSubscriberContext({ claims })

    await handle(makePayload(), context)

    expect(execute).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('multiple claims matched'),
      expect.objectContaining({ claimNumbers: ['WTY-000001', 'WTY-000002'] }),
    )
  })

  test('skips when no claim matches the tracking number', async () => {
    const { context, execute } = makeSubscriberContext({ claims: [] })

    await handle(makePayload(), context)

    expect(execute).not.toHaveBeenCalled()
  })

  test('skips when the shipment row is missing', async () => {
    const { context, execute } = makeSubscriberContext({ shipmentRow: null })

    await handle(makePayload(), context)

    expect(execute).not.toHaveBeenCalled()
  })

  test('skips without throwing when the carrier shipment table is missing', async () => {
    const missingTable = Object.assign(new Error('relation "carrier_shipments" does not exist'), { code: '42P01' })
    const { context, execute } = makeSubscriberContext({ shipmentError: missingTable })

    await expect(handle(makePayload(), context)).resolves.toBeUndefined()

    expect(execute).not.toHaveBeenCalled()
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  test('rethrows claim lookup database errors for persistent delivery retry', async () => {
    const databaseError = new Error('database connection interrupted')
    const { context, execute } = makeSubscriberContext({ claimError: databaseError })

    await expect(handle(makePayload(), context)).rejects.toBe(databaseError)

    expect(execute).not.toHaveBeenCalled()
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('failed to find matching warranty claims'),
      expect.objectContaining({ err: databaseError }),
    )
  })

  test('swallows an invalid-transition command rejection', async () => {
    const { context, execute } = makeSubscriberContext()
    execute.mockRejectedValueOnce(new CrudHttpError(400, {
      error: 'warranty_claims.errors.invalidTransition',
    }))

    await expect(handle(makePayload(), context)).resolves.toBeUndefined()

    expect(mockLoggerError).not.toHaveBeenCalled()
  })
})

describe('warranty claim transition system note', () => {
  test('accepts only warranty-claim translation keys', () => {
    expect(transitionClaimInputSchema.parse({
      id: CLAIM_ID,
      toStatus: 'received',
      systemNote: SYSTEM_NOTE,
    }).systemNote).toBe(SYSTEM_NOTE)
    expect(() => transitionClaimInputSchema.parse({
      id: CLAIM_ID,
      toStatus: 'received',
      systemNote: 'Return shipment delivered',
    })).toThrow()
  })

  test('stores the system note in the customer-visible status-change timeline payload', async () => {
    mockTransitionClaim = {
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimNumber: 'WTY-000001',
      claimType: 'warranty',
      status: 'awaiting_return',
      customerId: null,
      externalRef: null,
      awaitingStaffReply: false,
      slaPausedAt: null,
      updatedAt: new Date(),
      deletedAt: null,
    } as WarrantyClaim

    await transitionClaimCommand.execute({
      id: CLAIM_ID,
      toStatus: 'received',
      systemNote: SYSTEM_NOTE,
    }, makeTransitionCommandContext())

    expect(mockTimelineEvents).toHaveLength(1)
    expect(mockTimelineEvents[0]).toMatchObject({
      kind: 'status_changed',
      visibility: 'customer',
      payload: {
        from: 'awaiting_return',
        to: 'received',
        systemNote: SYSTEM_NOTE,
      },
    })
  })
})
