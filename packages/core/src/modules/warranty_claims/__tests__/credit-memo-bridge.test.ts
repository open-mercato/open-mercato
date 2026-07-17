import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { WarrantyClaim, WarrantyClaimLine } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const ORDER_ID = '55555555-5555-4555-8555-555555555555'
const FOREIGN_ORDER_ID = '66666666-6666-4666-8666-666666666666'
const CLAIM_LINE_ID = '77777777-7777-4777-8777-777777777777'
const ORDER_LINE_ID = '88888888-8888-4888-8888-888888888888'
const CREDIT_MEMO_ID = '99999999-9999-4999-8999-999999999999'
const FOREIGN_CREDIT_MEMO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CREDIT_MEMO_UPDATED_AT = '2026-07-17T09:30:00.000Z'
const CLAIM_UPDATED_AT = '2026-07-17T08:00:00.000Z'

let mockClaims: Array<Record<string, unknown>> = []
let mockLines: Array<Record<string, unknown>> = []
let mockEvents: Array<Record<string, unknown>> = []
let mockSourceOrderRow: Record<string, unknown> | null = null
let mockCreditMemoRow: Record<string, unknown> | null | undefined = null
let mockSourceLineRows = new Map<string, Record<string, unknown>>()
let mockSalesAvailable = true
let mockTransactionError: Error | null = null

const enforceWithGuardsMock = jest.fn(async () => undefined)
const commandBusExecuteMock = jest.fn<
  Promise<{ result: unknown }>,
  [string, { input: Record<string, unknown>; ctx: CommandRuntimeContext }]
>()
const loggerErrorMock = jest.fn()
const loggerInfoMock = jest.fn()
const apiCallMock = jest.fn()

jest.mock('#generated/entities.ids.generated', () => {
  const createEntityProxy = (moduleId: string) => new Proxy({}, {
    get: (_target, prop) => {
      if (moduleId === 'sales' && prop === 'sales_credit_memo' && !mockSalesAvailable) return undefined
      return typeof prop === 'string' ? `${moduleId}:${prop}` : undefined
    },
  })
  const E = new Proxy({}, {
    get: (_target, prop) => typeof prop === 'string' ? createEntityProxy(prop) : undefined,
  })
  return { E, M: E }
})

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    error: (...args: unknown[]) => loggerErrorMock(...args),
    info: (...args: unknown[]) => loggerInfoMock(...args),
    warn: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  }
  return { createLogger: () => logger }
})

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (...args: unknown[]) => enforceWithGuardsMock(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('../events', () => ({
  emitWarrantyClaimsEvent: jest.fn(async () => undefined),
}))

function entityName(entity: unknown): string {
  return typeof entity === 'function' && 'name' in entity ? String(entity.name) : ''
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function matchesWhere(record: Record<string, unknown>, where: unknown): boolean {
  const filters = asRecord(where)
  for (const [key, expected] of Object.entries(filters)) {
    const actual = key === 'claim'
      ? (typeof record.claim === 'string' ? record.claim : asRecord(record.claim).id)
      : record[key]
    if (key === 'deletedAt' && expected === null) {
      if (record.deletedAt !== null && record.deletedAt !== undefined) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (_em: unknown, entity: unknown, where: unknown) => {
    const name = entityName(entity)
    if (name === 'WarrantyClaim') return mockClaims.find((claim) => matchesWhere(claim, where)) ?? null
    if (name === 'WarrantyClaimLine') return mockLines.find((line) => matchesWhere(line, where)) ?? null
    return null
  },
  findWithDecryption: async (_em: unknown, entity: unknown, where: unknown) => {
    const name = entityName(entity)
    if (name === 'WarrantyClaim') return mockClaims.filter((claim) => matchesWhere(claim, where))
    if (name === 'WarrantyClaimLine') return mockLines.filter((line) => matchesWhere(line, where))
    return []
  },
}))

import { claimCommands, createCreditMemoCommand } from '../commands/claims'

function findIdWhere(wheres: Array<[string, string, unknown]>): string | null {
  const idWhere = wheres.find(([column]) => column === 'id')
  return typeof idWhere?.[2] === 'string' ? idWhere[2] : null
}

function makeKysely() {
  return {
    selectFrom: (table: string) => {
      const wheres: Array<[string, string, unknown]> = []
      const builder = {
        select: () => builder,
        where: (column: string, op: string, value: unknown) => {
          wheres.push([column, op, value])
          return builder
        },
        limit: () => builder,
        execute: async () => [],
        executeTakeFirst: async () => {
          const id = findIdWhere(wheres)
          if (table === 'sales_order_lines') return id ? mockSourceLineRows.get(id) : undefined
          if (table === 'sales_orders') return id === ORDER_ID ? mockSourceOrderRow ?? undefined : undefined
          if (table === 'sales_credit_memos' && id === CREDIT_MEMO_ID) {
            if (mockCreditMemoRow === undefined) throw new Error('credit memo lookup degraded')
            return mockCreditMemoRow ?? undefined
          }
          return undefined
        },
      }
      return builder
    },
  }
}

function makeFork(): EntityManager {
  const fork = {
    create: (_entity: unknown, data: Record<string, unknown>) => data,
    persist: (entity: unknown) => {
      const record = asRecord(entity)
      if ('kind' in record && 'visibility' in record) mockEvents.push(record)
    },
    flush: jest.fn(async () => undefined),
    transactional: async (fn: (tx: EntityManager) => Promise<unknown>) => {
      if (mockTransactionError) throw mockTransactionError
      return fn(fork as unknown as EntityManager)
    },
    getKysely: () => makeKysely(),
    fork: () => fork,
  }
  return fork as unknown as EntityManager
}

function makeCtx(): CommandRuntimeContext {
  const fork = makeFork()
  return {
    container: {
      resolve: (key: string) => {
        if (key === 'em') return { fork: () => fork }
        if (key === 'commandBus') return { execute: commandBusExecuteMock }
        if (key === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        throw new Error(`[internal] unregistered test dependency ${key}`)
      },
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: true, sub: USER_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: new Request('http://localhost/api/warranty_claims/credit-memo', { method: 'POST' }),
  } as unknown as CommandRuntimeContext
}

function seedClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const claim = {
    id: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    claimNumber: 'WTY-000321',
    claimType: 'warranty',
    status: 'received',
    channel: 'staff',
    priority: 'normal',
    orderId: ORDER_ID,
    salesReturnId: null,
    replacementOrderId: null,
    creditMemoId: null,
    advanceReplacement: false,
    updatedAt: new Date(CLAIM_UPDATED_AT),
    deletedAt: null,
    ...overrides,
  }
  mockClaims.push(claim)
  return claim
}

function seedLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const line = {
    id: CLAIM_LINE_ID,
    claim: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    lineNo: 1,
    lineStatus: 'received',
    disposition: 'credit',
    orderLineId: ORDER_LINE_ID,
    qtyClaimed: '1.0000',
    qtyApproved: '1.0000',
    qtyReceived: '1.0000',
    creditAmount: null,
    restockingFee: null,
    coreCreditAmount: null,
    deletedAt: null,
    ...overrides,
  }
  mockLines.push(line)
  return line
}

function sourceLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORDER_LINE_ID,
    order_id: ORDER_ID,
    name: 'Credited item',
    currency_code: 'USD',
    quantity: '1.0000',
    unit_price_net: '100.0000',
    unit_price_gross: '123.0000',
    total_net_amount: '100.0000',
    total_gross_amount: '123.0000',
    tax_rate: '23.0000',
    ...overrides,
  }
}

function seedSourceLine(id = ORDER_LINE_ID, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = sourceLine({ id, ...overrides })
  mockSourceLineRows.set(id, row)
  return row
}

function executeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID, ...overrides }
}

function creditMemoUndoLog(claim: Record<string, unknown>, updatedAt: string | null = CREDIT_MEMO_UPDATED_AT) {
  return {
    payload: {
      undo: {
        before: { ...claim, creditMemoId: null, lines: [] },
        after: { ...claim, lines: [] },
        creditMemo: { id: CREDIT_MEMO_ID, updatedAt },
      },
    },
  }
}

function createDispatch(): { input: Record<string, unknown>; ctx: CommandRuntimeContext } {
  const call = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.credit_memos.create')
  if (!call) throw new Error('sales.credit_memos.create was not dispatched')
  return call[1]
}

function dispatchedLines(): Array<Record<string, unknown>> {
  return createDispatch().input.lines as Array<Record<string, unknown>>
}

beforeEach(() => {
  mockClaims = []
  mockLines = []
  mockEvents = []
  mockSourceOrderRow = { id: ORDER_ID, currency_code: 'USD' }
  mockCreditMemoRow = { id: CREDIT_MEMO_ID, updated_at: CREDIT_MEMO_UPDATED_AT }
  mockSourceLineRows = new Map()
  mockSalesAvailable = true
  mockTransactionError = null
  enforceWithGuardsMock.mockReset()
  enforceWithGuardsMock.mockResolvedValue(undefined)
  commandBusExecuteMock.mockReset()
  commandBusExecuteMock.mockImplementation(async (commandId: string) => ({
    result: commandId === 'sales.credit_memos.create' ? { creditMemoId: CREDIT_MEMO_ID } : {},
  }))
  loggerErrorMock.mockReset()
  loggerInfoMock.mockReset()
  apiCallMock.mockReset()
  apiCallMock.mockResolvedValue({ ok: false, status: 403, result: { items: [] } })
})

describe('warranty_claims.claim.create_credit_memo amount contract', () => {
  it('is registered as an undoable warranty claim command', () => {
    expect(createCreditMemoCommand.id).toBe('warranty_claims.claim.create_credit_memo')
    expect(createCreditMemoCommand.isUndoable).toBe(true)
    expect(claimCommands).toContain(createCreditMemoCommand)
  })

  it('uses pure proration net from the source net basis without applying the tax formula', async () => {
    seedClaim()
    seedLine()
    seedSourceLine(ORDER_LINE_ID, {
      quantity: '4.0000',
      total_net_amount: '32.0000',
      total_gross_amount: '40.0000',
      tax_rate: '99.0000',
    })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0]).toMatchObject({
      totalNetAmount: '8.0000',
      totalGrossAmount: '10.0000',
      taxAmount: '2.0000',
    })
  })

  it('performs one fused multiply-divide for exact 1-of-3 proration without drift', async () => {
    seedClaim()
    seedLine()
    seedSourceLine(ORDER_LINE_ID, {
      quantity: '3.0000',
      total_net_amount: '10000.0000',
      total_gross_amount: '10000.0000',
      tax_rate: '0.0000',
    })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0]).toMatchObject({
      totalNetAmount: '3333.3333',
      totalGrossAmount: '3333.3333',
    })
  })

  it('prorates discounted totals instead of multiplying the pre-discount unit price', async () => {
    seedClaim()
    seedLine()
    seedSourceLine(ORDER_LINE_ID, {
      quantity: '2.0000',
      unit_price_net: '10.0000',
      unit_price_gross: '10.0000',
      total_net_amount: '15.0000',
      total_gross_amount: '15.0000',
      tax_rate: '0.0000',
    })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0].totalGrossAmount).toBe('7.5000')
  })

  it('normalizes a legacy positive-gross zero-net source line at 23 percent', async () => {
    seedClaim()
    seedLine()
    seedSourceLine(ORDER_LINE_ID, { total_net_amount: '0.0000' })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0]).toMatchObject({
      totalNetAmount: '100.0000',
      totalGrossAmount: '123.0000',
      taxAmount: '23.0000',
    })
  })

  it('uses creditAmount as the gross base and derives percentage-correct tax', async () => {
    seedClaim()
    seedLine({ creditAmount: '61.5000' })
    seedSourceLine()

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0]).toMatchObject({
      totalNetAmount: '50.0000',
      totalGrossAmount: '61.5000',
      taxAmount: '11.5000',
    })
  })

  it.each([
    ['deducts a fee', { creditAmount: '10.0000', restockingFee: '3.0000', coreCreditAmount: null }, '7.0000'],
    ['floors a negative adjustment at zero', { creditAmount: '5.0000', restockingFee: '6.0000', coreCreditAmount: null }, '0.0000'],
    ['adds a core credit', { creditAmount: '10.0000', restockingFee: null, coreCreditAmount: '2.0000' }, '12.0000'],
    ['treats null fee and core credit as zero', { creditAmount: '10.0000', restockingFee: null, coreCreditAmount: null }, '10.0000'],
  ])('%s', async (_label, lineOverrides, expectedGross) => {
    seedClaim()
    seedLine(lineOverrides)
    seedSourceLine(ORDER_LINE_ID, {
      total_net_amount: '10.0000',
      total_gross_amount: '10.0000',
      tax_rate: '0.0000',
    })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0].totalGrossAmount).toBe(expectedGross)
  })

  it('supports fractional credited quantities and rescaled unit-price division', async () => {
    seedClaim()
    seedLine({ qtyApproved: '0.7500', qtyReceived: '0.7500' })
    seedSourceLine(ORDER_LINE_ID, {
      quantity: '2.0000',
      total_net_amount: '20.0000',
      total_gross_amount: '20.0000',
      tax_rate: '0.0000',
    })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0]).toMatchObject({
      quantity: '0.7500',
      totalGrossAmount: '7.5000',
      unitPriceGross: '10.0000',
      unitPriceNet: '10.0000',
    })
  })

  it('caps credited quantity at qtyReceived and skips a line when nothing was received', async () => {
    const zeroReceivedClaimLineId = '10000000-0000-4000-8000-000000000001'
    const zeroReceivedOrderLineId = '20000000-0000-4000-8000-000000000001'
    seedClaim()
    seedLine({ qtyApproved: '2.0000', qtyReceived: '0.5000' })
    seedLine({
      id: zeroReceivedClaimLineId,
      orderLineId: zeroReceivedOrderLineId,
      qtyApproved: '1.0000',
      qtyReceived: '0.0000',
    })
    seedSourceLine(ORDER_LINE_ID, {
      quantity: '2.0000',
      total_net_amount: '20.0000',
      total_gross_amount: '20.0000',
      tax_rate: '0.0000',
    })
    seedSourceLine(zeroReceivedOrderLineId)

    const result = await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0]).toMatchObject({ quantity: '0.5000', totalGrossAmount: '5.0000' })
    expect(result.skippedLineIds).toEqual([zeroReceivedClaimLineId])
  })

  it('skips zero-quantity and currency-mismatched source lines', async () => {
    const zeroQuantityClaimLineId = '10000000-0000-4000-8000-000000000002'
    const currencyClaimLineId = '10000000-0000-4000-8000-000000000003'
    const zeroQuantityOrderLineId = '20000000-0000-4000-8000-000000000002'
    const currencyOrderLineId = '20000000-0000-4000-8000-000000000003'
    seedClaim()
    seedLine()
    seedLine({ id: zeroQuantityClaimLineId, orderLineId: zeroQuantityOrderLineId })
    seedLine({ id: currencyClaimLineId, orderLineId: currencyOrderLineId })
    seedSourceLine()
    seedSourceLine(zeroQuantityOrderLineId, { quantity: '0.0000' })
    seedSourceLine(currencyOrderLineId, { currency_code: 'EUR' })

    const result = await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(result.skippedLineIds).toEqual([zeroQuantityClaimLineId, currencyClaimLineId])
    expect(dispatchedLines()).toHaveLength(1)
  })

  it('rounds an exact half up at the 4-decimal boundary', async () => {
    seedClaim()
    seedLine()
    seedSourceLine(ORDER_LINE_ID, {
      quantity: '2.0000',
      total_net_amount: '0.0001',
      total_gross_amount: '0.0001',
      tax_rate: '0.0000',
    })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0].totalGrossAmount).toBe('0.0001')
  })

  it('omits a null source name and carries the warranty claim line id in metadata', async () => {
    seedClaim()
    seedLine()
    seedSourceLine(ORDER_LINE_ID, { name: null })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0]).not.toHaveProperty('name')
    expect(dispatchedLines()[0].metadata).toEqual({ warrantyClaimLineId: CLAIM_LINE_ID })
  })
})

describe('warranty_claims.claim.create_credit_memo guards and failure boundary', () => {
  it.each([
    ['requires an order', { orderId: null }, {}, 'warranty_claims.errors.creditMemoRequiresOrder'],
    ['requires an eligible claim status', { status: 'approved' }, {}, 'warranty_claims.errors.creditMemoInvalidStatus'],
    ['allows only one linked memo', { creditMemoId: FOREIGN_CREDIT_MEMO_ID }, {}, 'warranty_claims.errors.creditMemoAlreadyLinked'],
  ])('%s', async (_label, claimOverrides, lineOverrides, error) => {
    seedClaim(claimOverrides)
    seedLine(lineOverrides)
    seedSourceLine()

    await expect(createCreditMemoCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('rejects when the sales credit-memo entity is unavailable', async () => {
    mockSalesAvailable = false
    seedClaim()
    seedLine()

    await expect(createCreditMemoCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.creditMemoSalesUnavailable' } })
  })

  it('rejects when no lines survive eligibility and post-resolution degradation', async () => {
    seedClaim()
    seedLine({ disposition: 'replace' })

    await expect(createCreditMemoCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.creditMemoNoEligibleLines' } })
  })

  it('skips a foreign-order source line while preserving an eligible peer', async () => {
    const foreignClaimLineId = '10000000-0000-4000-8000-000000000004'
    const foreignOrderLineId = '20000000-0000-4000-8000-000000000004'
    seedClaim()
    seedLine()
    seedLine({ id: foreignClaimLineId, orderLineId: foreignOrderLineId })
    seedSourceLine()
    seedSourceLine(foreignOrderLineId, { order_id: FOREIGN_ORDER_ID })

    const result = await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(result.skippedLineIds).toEqual([foreignClaimLineId])
  })

  it('dispatches complete header totals and metadata with a scrubbed request context', async () => {
    seedClaim()
    seedLine()
    seedSourceLine()

    const result = await createCreditMemoCommand.execute(executeInput(), makeCtx())
    const dispatch = createDispatch()

    expect(dispatch.input).toMatchObject({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      currencyCode: 'USD',
      reason: 'WTY-000321',
      metadata: { warrantyClaimId: CLAIM_ID, warrantyClaimNumber: 'WTY-000321' },
      subtotalNetAmount: '100.0000',
      subtotalGrossAmount: '123.0000',
      taxTotalAmount: '23.0000',
      grandTotalNetAmount: '100.0000',
      grandTotalGrossAmount: '123.0000',
    })
    expect(dispatch.ctx.request).toBeUndefined()
    expect(result).toMatchObject({
      claimId: CLAIM_ID,
      creditMemoId: CREDIT_MEMO_ID,
      creditMemoUpdatedAt: CREDIT_MEMO_UPDATED_AT,
      grandTotalGrossAmount: '123.0000',
      currencyCode: 'USD',
    })
  })

  it('compensates a lost stamp race with the exact scoped delete input', async () => {
    const claim = seedClaim()
    seedLine()
    seedSourceLine()
    commandBusExecuteMock.mockImplementation(async (commandId: string) => {
      if (commandId === 'sales.credit_memos.create') {
        claim.creditMemoId = FOREIGN_CREDIT_MEMO_ID
        return { result: { creditMemoId: CREDIT_MEMO_ID } }
      }
      return { result: {} }
    })

    await expect(createCreditMemoCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.creditMemoAlreadyLinked' } })
    const deleteCall = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.credit_memos.delete')
    expect(deleteCall?.[1].input).toEqual({ id: CREDIT_MEMO_ID, organizationId: ORG_ID, tenantId: TENANT_ID })
    expect(deleteCall?.[1].ctx.request).toBeUndefined()
  })

  it('compensates a stamp failure with the exact scoped delete input and rethrows it', async () => {
    const stampFailure = new Error('credit memo stamp failed')
    mockTransactionError = stampFailure
    seedClaim()
    seedLine()
    seedSourceLine()

    await expect(createCreditMemoCommand.execute(executeInput(), makeCtx())).rejects.toBe(stampFailure)
    const deleteCall = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.credit_memos.delete')
    expect(deleteCall?.[1].input).toEqual({ id: CREDIT_MEMO_ID, organizationId: ORG_ID, tenantId: TENANT_ID })
  })

  it('elevates compensation failure over a lost-race 400 and records an orphan timeline entry', async () => {
    const claim = seedClaim()
    seedLine()
    seedSourceLine()
    commandBusExecuteMock.mockImplementation(async (commandId: string) => {
      if (commandId === 'sales.credit_memos.create') {
        claim.creditMemoId = FOREIGN_CREDIT_MEMO_ID
        return { result: { creditMemoId: CREDIT_MEMO_ID } }
      }
      throw new Error('delete transport down')
    })

    await expect(createCreditMemoCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 500, body: { error: 'warranty_claims.errors.save_failed' } })
    expect(mockEvents.some((event) => asRecord(event.payload).action === 'credit_memo_orphaned')).toBe(true)
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('orphaned credit memo'),
      expect.objectContaining({ claimId: CLAIM_ID, creditMemoId: CREDIT_MEMO_ID }),
    )
  })
})

describe('warranty_claims.claim.create_credit_memo undo and surfaces', () => {
  it('deletes a token-matching credit memo and restores the claim snapshot', async () => {
    const claim = seedClaim({ creditMemoId: CREDIT_MEMO_ID })

    await createCreditMemoCommand.undo?.({ logEntry: creditMemoUndoLog(claim), ctx: makeCtx() } as never)

    const deleteCall = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.credit_memos.delete')
    expect(deleteCall?.[1].input).toEqual({ id: CREDIT_MEMO_ID, organizationId: ORG_ID, tenantId: TENANT_ID })
    expect(claim.creditMemoId).toBeNull()
  })

  it.each([
    ['changed', CREDIT_MEMO_UPDATED_AT, '2026-07-17T10:00:00.000Z'],
    ['missing', null, CREDIT_MEMO_UPDATED_AT],
  ])('aborts undo when the stored token is %s while the row exists', async (_label, storedToken, currentToken) => {
    const claim = seedClaim({ creditMemoId: CREDIT_MEMO_ID })
    mockCreditMemoRow = { id: CREDIT_MEMO_ID, updated_at: currentToken }

    await expect(createCreditMemoCommand.undo?.({ logEntry: creditMemoUndoLog(claim, storedToken), ctx: makeCtx() } as never))
      .rejects.toMatchObject({ status: 409, body: { error: 'warranty_claims.errors.creditMemoChangedUndoAborted' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(claim.creditMemoId).toBe(CREDIT_MEMO_ID)
  })

  it('restores without delete when the credit memo row is definitively absent', async () => {
    mockCreditMemoRow = null
    const claim = seedClaim({ creditMemoId: CREDIT_MEMO_ID })

    await createCreditMemoCommand.undo?.({ logEntry: creditMemoUndoLog(claim), ctx: makeCtx() } as never)

    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(claim.creditMemoId).toBeNull()
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.stringContaining('already absent'),
      expect.objectContaining({ claimId: CLAIM_ID, creditMemoId: CREDIT_MEMO_ID }),
    )
  })

  it('treats a degraded credit-memo re-read as a conflict', async () => {
    mockCreditMemoRow = undefined
    const claim = seedClaim({ creditMemoId: CREDIT_MEMO_ID })

    await expect(createCreditMemoCommand.undo?.({ logEntry: creditMemoUndoLog(claim), ctx: makeCtx() } as never))
      .rejects.toMatchObject({ status: 409, body: { error: 'warranty_claims.errors.creditMemoChangedUndoAborted' } })
  })

  it('declares both route features and the complete OpenAPI response set', async () => {
    const routeModule = await import('../api/credit-memo/route')

    expect(routeModule.metadata.POST.requireFeatures).toEqual([
      'warranty_claims.claim.manage',
      'sales.credit_memos.manage',
    ])
    expect(routeModule.openApi.methods.POST?.responses.map((response) => response.status)).toEqual([
      200,
      400,
      401,
      403,
      409,
    ])
  })

  it('exports a no-custom-values picker that degrades to no options without the sales grant', async () => {
    const editPage = await import('../backend/warranty_claims/[id]/edit/page')
    const field = editPage.createCreditMemoFieldConfig((key: string, fallback?: string) => fallback ?? key, ORDER_ID)

    expect(field).toMatchObject({ id: 'creditMemoId', type: 'combobox', allowCustomValues: false })
    await expect(field.loadOptions?.('CM')).resolves.toEqual([])
    await expect(field.resolveLabel?.(CREDIT_MEMO_ID)).resolves.toBe('Credit memo unavailable')
  })

  it('keeps full 4-decimal tax-rate precision in the net derivation at 8.125 percent', async () => {
    seedClaim()
    seedLine({ creditAmount: '10000.0000' })
    seedSourceLine(ORDER_LINE_ID, { tax_rate: '8.1250' })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0]).toMatchObject({
      totalNetAmount: '9248.5549',
      totalGrossAmount: '10000.0000',
      taxAmount: '751.4451',
    })
  })

  it('re-derives a zero-rounded net from gross at the sub-cent clamp corner', async () => {
    seedClaim()
    seedLine()
    seedSourceLine(ORDER_LINE_ID, {
      quantity: '3.0000',
      total_gross_amount: '0.0003',
      total_net_amount: '0.0001',
      tax_rate: '23.0000',
    })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    expect(dispatchedLines()[0]).toMatchObject({
      totalGrossAmount: '0.0001',
      totalNetAmount: '0.0001',
      taxAmount: '0.0000',
    })
  })

  it('emits money strings that survive a 4-decimal float round-trip', async () => {
    seedClaim()
    seedLine({ qtyClaimed: '3.0000', qtyApproved: '3.0000', qtyReceived: '2.0000', restockingFee: '10.0000' })
    seedSourceLine(ORDER_LINE_ID, {
      quantity: '4.0000',
      total_net_amount: '400.0000',
      total_gross_amount: '492.0000',
      tax_rate: '23.0000',
    })

    await createCreditMemoCommand.execute(executeInput(), makeCtx())

    const dispatch = createDispatch().input as Record<string, unknown>
    const line = dispatchedLines()[0]
    const monetaryValues = [
      dispatch.subtotalNetAmount,
      dispatch.subtotalGrossAmount,
      dispatch.taxTotalAmount,
      dispatch.grandTotalNetAmount,
      dispatch.grandTotalGrossAmount,
      line.unitPriceNet,
      line.unitPriceGross,
      line.taxAmount,
      line.totalNetAmount,
      line.totalGrossAmount,
    ]
    for (const value of monetaryValues) {
      expect(typeof value).toBe('string')
      expect(Number(value as string).toFixed(4)).toBe(value)
    }
  })

  it('rejects a stale optimistic-lock token before dispatching any sales command', async () => {
    seedClaim()
    seedLine()
    seedSourceLine()
    enforceWithGuardsMock.mockRejectedValueOnce(
      Object.assign(new Error('[internal] stale token'), { status: 409, body: { error: 'conflict' } }),
    )

    await expect(
      createCreditMemoCommand.execute(executeInput({ updatedAt: '2026-07-16T00:00:00.000Z' }), makeCtx()),
    ).rejects.toMatchObject({ status: 409 })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('rejects a manual creditMemoId link that does not resolve in the tenant scope', async () => {
    const { validateClaimReferences } = await import('../commands/claims')

    await expect(
      validateClaimReferences(
        makeCtx(),
        { tenantId: TENANT_ID, organizationId: ORG_ID },
        { creditMemoId: FOREIGN_CREDIT_MEMO_ID },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
})
