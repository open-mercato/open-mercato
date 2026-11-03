import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { WarrantyClaim, WarrantyClaimLine } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const ORDER_ID = '55555555-5555-4555-8555-555555555555'
const FOREIGN_ORDER_ID = '66666666-6666-4666-8666-666666666666'
const BILLING_ADDRESS_ID = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
const SHIPPING_ADDRESS_ID = 'cccccccc-2222-4222-8222-cccccccccccc'
const ORDER_LINE_ID = '77777777-7777-4777-8777-777777777777'
const CREATED_ORDER_ID = '88888888-8888-4888-8888-888888888888'
const PRODUCT_ID = '99999999-9999-4999-8999-999999999999'
const VARIANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CUSTOMER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CONTACT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CHANNEL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const REPLACEMENT_UPDATED_AT = '2026-07-17T09:30:00.000Z'
const APPROVAL_UPDATED_AT = '2026-07-17T09:30:00.500Z'
const CLAIM_UPDATED_AT = '2026-07-17T08:00:00.000Z'

let mockClaims: Array<Record<string, unknown>> = []
let mockLines: Array<Record<string, unknown>> = []
let mockEvents: Array<Record<string, unknown>> = []
let mockSourceOrderRow: Record<string, unknown> | null = null
let mockReplacementOrderRow: Record<string, unknown> | null = null
let mockReplacementOrderLookupError: Error | null = null
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
const actionLogListMock = jest.fn()

jest.mock('#generated/entities.ids.generated', () => {
  const createEntityProxy = (moduleId: string) => new Proxy({}, {
    get: (_target, prop) => {
      if (moduleId === 'sales' && prop === 'sales_order' && !mockSalesAvailable) return undefined
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

import { claimCommands, createReplacementOrderCommand } from '../commands/claims'

function findIdWhere(wheres: Array<[string, string, unknown]>): string | null {
  const idWhere = wheres.find(([column]) => column === 'id')
  return typeof idWhere?.[2] === 'string' ? idWhere[2] : null
}

function rowSatisfiesWheres(row: Record<string, unknown>, wheres: Array<[string, string, unknown]>): boolean {
  return wheres.every(([column, op, value]) => {
    if (op === 'is' && value === null) return row[column] === null || row[column] === undefined
    if (op === 'in' && Array.isArray(value)) return value.includes(row[column])
    return row[column] === value
  })
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
        execute: async () => table === 'sales_order_lines'
          ? Array.from(mockSourceLineRows.values()).filter((row) => rowSatisfiesWheres(row, wheres))
          : [],
        executeTakeFirst: async () => {
          const id = findIdWhere(wheres)
          if (table === 'sales_order_lines') return id ? mockSourceLineRows.get(id) : undefined
          if (table !== 'sales_orders') return undefined
          if (id === ORDER_ID) return mockSourceOrderRow ?? undefined
          if (id === CREATED_ORDER_ID) {
            if (mockReplacementOrderLookupError) throw mockReplacementOrderLookupError
            return mockReplacementOrderRow ?? undefined
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
        if (key === 'actionLogService') return { list: actionLogListMock }
        if (key === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        throw new Error(`[internal] unregistered test dependency ${key}`)
      },
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: true, sub: USER_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: new Request('http://localhost/api/warranty_claims/replacement-order', { method: 'POST' }),
  } as unknown as CommandRuntimeContext
}

function seedClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const claim = {
    id: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    claimNumber: 'WTY-000321',
    claimType: 'warranty',
    status: 'approved',
    channel: 'staff',
    priority: 'normal',
    orderId: ORDER_ID,
    salesReturnId: null,
    replacementOrderId: null,
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
    id: ORDER_LINE_ID,
    claim: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    lineNo: 1,
    lineStatus: 'approved',
    disposition: 'replace',
    orderLineId: ORDER_LINE_ID,
    qtyClaimed: '2.0000',
    qtyApproved: '1.0000',
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
    product_id: PRODUCT_ID,
    product_variant_id: VARIANT_ID,
    name: 'Replacement item',
    kind: 'product',
    currency_code: 'USD',
    unit_price_net: '12.3400',
    unit_price_gross: '14.7580',
    tax_rate: '19.5000',
    tenant_id: TENANT_ID,
    organization_id: ORG_ID,
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

function replacementUndoLog(claim: Record<string, unknown>, updatedAt: string | null = REPLACEMENT_UPDATED_AT) {
  return {
    payload: {
      undo: {
        before: { ...claim, replacementOrderId: null, advanceReplacement: false, lines: [] },
        after: { ...claim, lines: [] },
        replacementOrder: { id: CREATED_ORDER_ID, updatedAt },
      },
    },
  }
}

function createDispatch(): { input: Record<string, unknown>; ctx: CommandRuntimeContext } {
  const call = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.orders.create')
  if (!call) throw new Error('sales.orders.create was not dispatched')
  return call[1]
}

function approvalLog() {
  const graph = {
    order: {
      id: CREATED_ORDER_ID,
      updatedAt: REPLACEMENT_UPDATED_AT,
      status: null,
      statusEntryId: null,
      internalNotes: null,
    },
    lines: [], adjustments: [], addresses: [], tags: [], shipments: [], payments: [], notes: [],
  }
  return {
    commandId: 'sales.orders.update',
    executionState: 'done',
    resourceKind: 'sales.order',
    resourceId: CREATED_ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    commandPayload: { __redoInput: { id: CREATED_ORDER_ID, statusEntryId: 'pending-entry' } },
    snapshotBefore: graph,
    snapshotAfter: {
      ...graph,
      order: { ...graph.order, updatedAt: APPROVAL_UPDATED_AT, status: 'pending_approval', statusEntryId: 'pending-entry' },
      notes: [{ id: 'status-note', body: 'Status changed' }],
    },
  }
}

beforeEach(() => {
  mockClaims = []
  mockLines = []
  mockEvents = []
  mockSourceOrderRow = {
    id: ORDER_ID,
    currency_code: 'USD',
    customer_entity_id: CUSTOMER_ID,
    customer_contact_id: CONTACT_ID,
    billing_address_id: BILLING_ADDRESS_ID,
    shipping_address_id: SHIPPING_ADDRESS_ID,
    channel_id: CHANNEL_ID,
  }
  mockReplacementOrderRow = { id: CREATED_ORDER_ID, updated_at: REPLACEMENT_UPDATED_AT }
  mockReplacementOrderLookupError = null
  mockSourceLineRows = new Map()
  mockSalesAvailable = true
  mockTransactionError = null
  enforceWithGuardsMock.mockReset()
  enforceWithGuardsMock.mockResolvedValue(undefined)
  commandBusExecuteMock.mockReset()
  commandBusExecuteMock.mockImplementation(async (commandId: string) => ({
    result: commandId === 'sales.orders.create' ? { orderId: CREATED_ORDER_ID } : {},
  }))
  loggerErrorMock.mockReset()
  loggerInfoMock.mockReset()
  actionLogListMock.mockReset()
  actionLogListMock.mockResolvedValue({ items: [], total: 0 })
})

describe('warranty_claims.claim.create_replacement_order', () => {
  it('is registered as an undoable warranty claim command', () => {
    expect(createReplacementOrderCommand.id).toBe('warranty_claims.claim.create_replacement_order')
    expect(createReplacementOrderCommand.isUndoable).toBe(true)
    expect(claimCommands).toContain(createReplacementOrderCommand)
  })

  it('rejects a claim without a linked order', async () => {
    seedClaim({ orderId: null })
    seedLine()

    await expect(createReplacementOrderCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.replacementOrderRequiresOrder' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('rejects an ineligible claim status', async () => {
    seedClaim({ status: 'draft' })
    seedLine()

    await expect(createReplacementOrderCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.replacementInvalidStatus' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('rejects a claim already linked to a replacement order', async () => {
    seedClaim({ replacementOrderId: CREATED_ORDER_ID })
    seedLine()

    await expect(createReplacementOrderCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.replacementAlreadyLinked' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('rejects when the sales order entity is unavailable', async () => {
    mockSalesAvailable = false
    seedClaim()
    seedLine()

    await expect(createReplacementOrderCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.replacementSalesUnavailable' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('rejects when the linked source order cannot be resolved', async () => {
    mockSourceOrderRow = null
    seedClaim()
    seedLine()

    await expect(createReplacementOrderCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.replacementOrderRequiresOrder' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('filters every ineligible or degraded line class and reports their claim-line ids', async () => {
    seedClaim()
    const eligibleId = '10000000-0000-4000-8000-000000000001'
    const nonReplaceId = '10000000-0000-4000-8000-000000000002'
    const fractionalId = '10000000-0000-4000-8000-000000000003'
    const zeroId = '10000000-0000-4000-8000-000000000004'
    const unlinkedId = '10000000-0000-4000-8000-000000000005'
    const identitylessId = '10000000-0000-4000-8000-000000000006'
    const foreignOrderId = '10000000-0000-4000-8000-000000000007'
    const identitylessOrderLineId = '20000000-0000-4000-8000-000000000006'
    const foreignOrderLineId = '20000000-0000-4000-8000-000000000007'
    seedLine({ id: eligibleId })
    seedLine({ id: nonReplaceId, disposition: 'credit' })
    seedLine({ id: fractionalId, qtyApproved: '1.5000' })
    seedLine({ id: zeroId, qtyApproved: '0.0000' })
    seedLine({ id: unlinkedId, orderLineId: null })
    seedLine({ id: identitylessId, orderLineId: identitylessOrderLineId })
    seedLine({ id: foreignOrderId, orderLineId: foreignOrderLineId })
    seedSourceLine()
    seedSourceLine(identitylessOrderLineId, {
      product_id: null,
      product_variant_id: null,
      name: '   ',
    })
    seedSourceLine(foreignOrderLineId, { order_id: FOREIGN_ORDER_ID })

    const result = await createReplacementOrderCommand.execute(executeInput(), makeCtx())

    expect(result.skippedLineIds).toEqual([
      nonReplaceId,
      fractionalId,
      zeroId,
      unlinkedId,
      identitylessId,
      foreignOrderId,
    ])
    expect(asRecord(createDispatch().input).lines).toEqual([
      expect.objectContaining({ productId: PRODUCT_ID, quantity: '1.0000' }),
    ])
  })

  it('rejects when post-resolution degradation leaves no eligible lines', async () => {
    seedClaim()
    seedLine()

    await expect(createReplacementOrderCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.replacementNoEligibleLines' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('uses zero pricing by default, copies line kind, and scrubs the nested request context', async () => {
    seedClaim()
    seedLine({ qtyApproved: null, qtyClaimed: '3.0000' })
    seedSourceLine(ORDER_LINE_ID, { kind: 'service' })

    const result = await createReplacementOrderCommand.execute(executeInput(), makeCtx())
    const dispatch = createDispatch()
    const lines = dispatch.input.lines as Array<Record<string, unknown>>

    expect(dispatch.input).toMatchObject({
      customerEntityId: CUSTOMER_ID,
      customerContactId: CONTACT_ID,
      billingAddressId: BILLING_ADDRESS_ID,
      shippingAddressId: SHIPPING_ADDRESS_ID,
      channelId: CHANNEL_ID,
    })
    expect(lines).toEqual([expect.objectContaining({
      kind: 'service',
      currencyCode: 'USD',
      quantity: '3.0000',
      unitPriceNet: '0',
      unitPriceGross: '0',
    })])
    expect(lines[0]).not.toHaveProperty('taxRate')
    expect(dispatch.ctx.request).toBeUndefined()
    expect(result).toMatchObject({
      claimId: CLAIM_ID,
      replacementOrderId: CREATED_ORDER_ID,
      replacementOrderUpdatedAt: REPLACEMENT_UPDATED_AT,
      pricing: 'zero',
    })
  })

  it('does not require source financial fields for zero-priced replacements', async () => {
    seedClaim()
    seedLine()
    seedSourceLine(ORDER_LINE_ID, {
      unit_price_net: null,
      unit_price_gross: null,
      tax_rate: null,
    })

    await createReplacementOrderCommand.execute(executeInput({ pricing: 'zero' }), makeCtx())
    const lines = createDispatch().input.lines as Array<Record<string, unknown>>

    expect(lines).toEqual([expect.objectContaining({
      unitPriceNet: '0',
      unitPriceGross: '0',
    })])
    expect(lines[0]).not.toHaveProperty('taxRate')
  })

  it('copies original unit prices and tax rate verbatim', async () => {
    seedClaim()
    seedLine()
    seedSourceLine()

    await createReplacementOrderCommand.execute(executeInput({ pricing: 'original' }), makeCtx())
    const lines = createDispatch().input.lines as Array<Record<string, unknown>>

    expect(lines[0]).toMatchObject({
      unitPriceNet: '12.3400',
      unitPriceGross: '14.7580',
      taxRate: '19.5000',
    })
  })

  it('copies source-order fields and omits every null optional from the nested create input', async () => {
    mockSourceOrderRow = {
      id: ORDER_ID,
      currency_code: 'EUR',
      customer_entity_id: null,
      customer_contact_id: null,
      billing_address_id: null,
      shipping_address_id: null,
      channel_id: null,
    }
    seedClaim()
    seedLine()
    seedSourceLine(ORDER_LINE_ID, {
      product_id: null,
      product_variant_id: VARIANT_ID,
      name: null,
      currency_code: 'CHF',
    })

    await createReplacementOrderCommand.execute(executeInput(), makeCtx())
    const input = createDispatch().input
    const lines = input.lines as Array<Record<string, unknown>>

    expect(input).toMatchObject({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'EUR',
      metadata: { warrantyClaimId: CLAIM_ID, warrantyClaimNumber: 'WTY-000321' },
    })
    for (const key of [
      'customerEntityId',
      'customerContactId',
      'billingAddressId',
      'shippingAddressId',
      'channelId',
    ]) expect(input).not.toHaveProperty(key)
    expect(lines[0]).toMatchObject({ productVariantId: VARIANT_ID, currencyCode: 'CHF' })
    expect(lines[0]).not.toHaveProperty('productId')
    expect(lines[0]).not.toHaveProperty('name')
  })

  it.each([
    ['approved', true],
    ['awaiting_return', true],
    ['received', false],
    ['inspecting', false],
    ['resolved', false],
  ])('sets advanceReplacement for %s claims only when appropriate', async (status, expected) => {
    const claim = seedClaim({ status })
    seedLine()
    seedSourceLine()

    await createReplacementOrderCommand.execute(executeInput(), makeCtx())

    expect(claim.advanceReplacement).toBe(expected)
  })

  it('compensates a lost stamp race and returns the already-linked error', async () => {
    const claim = seedClaim()
    seedLine()
    seedSourceLine()
    commandBusExecuteMock.mockImplementation(async (commandId: string) => {
      if (commandId === 'sales.orders.create') {
        claim.replacementOrderId = FOREIGN_ORDER_ID
        return { result: { orderId: CREATED_ORDER_ID } }
      }
      return { result: {} }
    })

    await expect(createReplacementOrderCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.replacementAlreadyLinked' } })
    const deleteCall = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.orders.delete')
    expect(deleteCall?.[1].input).toEqual({ id: CREATED_ORDER_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(deleteCall?.[1].ctx.request).toBeUndefined()
  })

  it('compensates a stamp failure and rethrows the original failure', async () => {
    const stampFailure = new Error('replacement stamp failed')
    mockTransactionError = stampFailure
    seedClaim()
    seedLine()
    seedSourceLine()

    await expect(createReplacementOrderCommand.execute(executeInput(), makeCtx())).rejects.toBe(stampFailure)
    expect(commandBusExecuteMock.mock.calls.some(([commandId]) => commandId === 'sales.orders.delete')).toBe(true)
  })

  it('surfaces a 500-class orphan error and attempts an orphan timeline entry when compensation fails', async () => {
    const claim = seedClaim()
    seedLine()
    seedSourceLine()
    commandBusExecuteMock.mockImplementation(async (commandId: string) => {
      if (commandId === 'sales.orders.create') {
        claim.replacementOrderId = FOREIGN_ORDER_ID
        return { result: { orderId: CREATED_ORDER_ID } }
      }
      throw new Error('delete transport down')
    })

    await expect(createReplacementOrderCommand.execute(executeInput(), makeCtx()))
      .rejects.toMatchObject({ status: 500, body: { error: 'warranty_claims.errors.save_failed' } })
    expect(mockEvents.some((event) => asRecord(event.payload).action === 'replacement_order_orphaned')).toBe(true)
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('orphaned sales order'),
      expect.objectContaining({ claimId: CLAIM_ID, replacementOrderId: CREATED_ORDER_ID }),
    )
  })

  it('undo deletes a token-matching order with its own version and restores the claim snapshot', async () => {
    const claim = seedClaim({ replacementOrderId: CREATED_ORDER_ID, advanceReplacement: true })
    const logEntry = replacementUndoLog(claim)

    await createReplacementOrderCommand.undo?.({ logEntry, ctx: makeCtx() } as never)

    const deleteCall = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.orders.delete')
    expect(deleteCall?.[1].input).toEqual({ id: CREATED_ORDER_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(deleteCall?.[1].ctx.request?.headers.get('x-om-ext-optimistic-lock-expected-updated-at')).toBe(REPLACEMENT_UPDATED_AT)
    expect(claim.replacementOrderId).toBeNull()
    expect(claim.advanceReplacement).toBe(false)
  })

  it('undo accepts the audited initial approval update between the saved and current versions', async () => {
    const claim = seedClaim({ replacementOrderId: CREATED_ORDER_ID, advanceReplacement: true })
    mockReplacementOrderRow = { id: CREATED_ORDER_ID, updated_at: APPROVAL_UPDATED_AT }
    actionLogListMock.mockResolvedValue({ items: [approvalLog()], total: 1 })

    await createReplacementOrderCommand.undo?.({ logEntry: replacementUndoLog(claim), ctx: makeCtx() } as never)

    expect(actionLogListMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID, organizationId: ORG_ID, resourceKind: 'sales.order',
      resourceId: CREATED_ORDER_ID, includeRelated: true, after: new Date(REPLACEMENT_UPDATED_AT),
    }))
    expect(commandBusExecuteMock).toHaveBeenCalledWith('sales.orders.delete', expect.anything())
    const deleteCall = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.orders.delete')
    expect(deleteCall?.[1].ctx.request?.headers.get('x-om-ext-optimistic-lock-expected-updated-at')).toBe(APPROVAL_UPDATED_AT)
    expect(claim.replacementOrderId).toBeNull()
    expect(claim.advanceReplacement).toBe(false)
  })

  it('preserves the claim link when sales rejects an edit after approval evidence was validated', async () => {
    const claim = seedClaim({ replacementOrderId: CREATED_ORDER_ID, advanceReplacement: true })
    mockReplacementOrderRow = { id: CREATED_ORDER_ID, updated_at: APPROVAL_UPDATED_AT }
    actionLogListMock.mockResolvedValue({ items: [approvalLog()], total: 1 })
    const conflict = new CrudHttpError(409, { code: 'optimistic_lock_conflict' })
    commandBusExecuteMock.mockRejectedValue(conflict)

    await expect(createReplacementOrderCommand.undo?.({ logEntry: replacementUndoLog(claim), ctx: makeCtx() } as never))
      .rejects.toBe(conflict)

    expect(actionLogListMock).toHaveBeenCalledTimes(1)
    expect(claim.replacementOrderId).toBe(CREATED_ORDER_ID)
    expect(claim.advanceReplacement).toBe(true)
    expect(mockEvents).toHaveLength(0)
  })

  it.each([
    ['an earlier user edit', (entry: ReturnType<typeof approvalLog>) => { entry.snapshotBefore.order.updatedAt = '2026-07-17T09:30:00.100Z' }],
    ['a later user edit', (entry: ReturnType<typeof approvalLog>) => { entry.snapshotAfter.order.updatedAt = '2026-07-17T09:30:00.400Z' }],
    ['an approval decision', (entry: ReturnType<typeof approvalLog>) => { entry.snapshotAfter.order.status = 'approved' }],
    ['changed order data', (entry: ReturnType<typeof approvalLog>) => { Object.assign(entry.snapshotAfter.order, { internalNotes: 'User edit' }) }],
    ['changed line data', (entry: ReturnType<typeof approvalLog>) => { Object.assign(entry.snapshotAfter, { lines: [{ id: 'new-line' }] }) }],
    ['a different tenant', (entry: ReturnType<typeof approvalLog>) => { entry.tenantId = FOREIGN_ORDER_ID }],
    ['a different organization', (entry: ReturnType<typeof approvalLog>) => { entry.organizationId = FOREIGN_ORDER_ID }],
    ['a historical snapshot without versions', (entry: ReturnType<typeof approvalLog>) => { Object.assign(entry.snapshotBefore.order, { updatedAt: undefined }) }],
    ['an additional input field', (entry: ReturnType<typeof approvalLog>) => { Object.assign(entry.commandPayload.__redoInput, { internalNotes: 'User edit' }) }],
    ['an undone approval update', (entry: ReturnType<typeof approvalLog>) => { entry.executionState = 'undone' }],
    ['a foreign order', (entry: ReturnType<typeof approvalLog>) => { entry.resourceId = FOREIGN_ORDER_ID }],
    ['changed payment data', (entry: ReturnType<typeof approvalLog>) => { Object.assign(entry.snapshotAfter, { payments: [{ id: 'new-payment' }] }) }],
    ['a changed dictionary entry', (entry: ReturnType<typeof approvalLog>) => { entry.snapshotAfter.order.statusEntryId = 'different-entry' }],
  ])('undo refuses %s despite a pending-approval audit row', async (_label, mutate) => {
    const claim = seedClaim({ replacementOrderId: CREATED_ORDER_ID, advanceReplacement: true })
    const entry = approvalLog()
    mutate(entry)
    actionLogListMock.mockResolvedValue({ items: [entry], total: 1 })
    mockReplacementOrderRow = { id: CREATED_ORDER_ID, updated_at: APPROVAL_UPDATED_AT }

    await expect(createReplacementOrderCommand.undo?.({ logEntry: replacementUndoLog(claim), ctx: makeCtx() } as never))
      .rejects.toMatchObject({ status: 409 })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(claim.replacementOrderId).toBe(CREATED_ORDER_ID)
  })

  it('undo refuses additional related operations even when the order has only reached pending approval', async () => {
    const claim = seedClaim({ replacementOrderId: CREATED_ORDER_ID })
    actionLogListMock.mockResolvedValue({ items: [approvalLog(), { commandId: 'sales.notes.create' }], total: 2 })
    mockReplacementOrderRow = { id: CREATED_ORDER_ID, updated_at: APPROVAL_UPDATED_AT }

    await expect(createReplacementOrderCommand.undo?.({ logEntry: replacementUndoLog(claim), ctx: makeCtx() } as never))
      .rejects.toMatchObject({ status: 409 })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('redo omits the original claim version while preserving the current request context', async () => {
    seedClaim()
    seedLine()
    seedSourceLine()
    const ctx = makeCtx()

    await createReplacementOrderCommand.redo?.({ input: executeInput({ updatedAt: CLAIM_UPDATED_AT }), ctx } as never)

    expect(enforceWithGuardsMock).toHaveBeenCalledWith(ctx.container, expect.objectContaining({
      expected: undefined, request: ctx.request,
    }))
    expect(commandBusExecuteMock).toHaveBeenCalledWith('sales.orders.create', expect.anything())
  })

  it.each([
    ['a changed token', '2026-07-17T10:00:00.000Z'],
    ['a missing stored token', null],
  ])('undo aborts for %s while the replacement order exists', async (_label, storedToken) => {
    const claim = seedClaim({ replacementOrderId: CREATED_ORDER_ID, advanceReplacement: true })
    const logEntry = replacementUndoLog(claim, storedToken)
    if (storedToken) mockReplacementOrderRow = { id: CREATED_ORDER_ID, updated_at: '2026-07-17T10:30:00.000Z' }

    await expect(createReplacementOrderCommand.undo?.({ logEntry, ctx: makeCtx() } as never))
      .rejects.toMatchObject({ status: 409, body: { error: 'warranty_claims.errors.replacementOrderChangedUndoAborted' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(claim.replacementOrderId).toBe(CREATED_ORDER_ID)
    expect(claim.advanceReplacement).toBe(true)
  })

  it('undo treats an absent sales order table as a 409 and does not restore the claim', async () => {
    mockReplacementOrderLookupError = Object.assign(new Error('relation "sales_orders" does not exist'), { code: '42P01' })
    const claim = seedClaim({ replacementOrderId: CREATED_ORDER_ID, advanceReplacement: true })

    await expect(createReplacementOrderCommand.undo?.({ logEntry: replacementUndoLog(claim), ctx: makeCtx() } as never))
      .rejects.toMatchObject({ status: 409, body: { error: 'warranty_claims.errors.replacementOrderChangedUndoAborted' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(claim.replacementOrderId).toBe(CREATED_ORDER_ID)
  })

  it('undo propagates a degraded replacement-order re-read and does not restore the claim', async () => {
    const lookupFailure = Object.assign(new Error('connection terminated'), { code: '08006' })
    mockReplacementOrderLookupError = lookupFailure
    const claim = seedClaim({ replacementOrderId: CREATED_ORDER_ID, advanceReplacement: true })

    await expect(createReplacementOrderCommand.undo?.({ logEntry: replacementUndoLog(claim), ctx: makeCtx() } as never))
      .rejects.toBe(lookupFailure)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(claim.replacementOrderId).toBe(CREATED_ORDER_ID)
  })

  it('undo restores the snapshot without deleting when the replacement order is definitively absent', async () => {
    mockReplacementOrderRow = null
    const claim = seedClaim({ replacementOrderId: CREATED_ORDER_ID, advanceReplacement: true })

    await createReplacementOrderCommand.undo?.({ logEntry: replacementUndoLog(claim), ctx: makeCtx() } as never)

    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(claim.replacementOrderId).toBeNull()
    expect(claim.advanceReplacement).toBe(false)
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.stringContaining('already absent'),
      expect.objectContaining({ claimId: CLAIM_ID, replacementOrderId: CREATED_ORDER_ID }),
    )
  })

  it('propagates a stale optimistic-lock conflict before reading or dispatching sales data', async () => {
    const conflict = new CrudHttpError(409, { error: 'crud.errors.optimisticLockConflict' })
    enforceWithGuardsMock.mockRejectedValueOnce(conflict)
    seedClaim()
    seedLine()
    seedSourceLine()

    await expect(createReplacementOrderCommand.execute(executeInput({ updatedAt: CLAIM_UPDATED_AT }), makeCtx()))
      .rejects.toBe(conflict)
    expect(enforceWithGuardsMock).toHaveBeenCalled()
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('declares both route features and the complete OpenAPI response set', async () => {
    const routeModule = await import('../api/replacement-order/route')

    expect(routeModule.metadata.POST.requireFeatures).toEqual([
      'warranty_claims.claim.manage',
      'sales.orders.manage',
    ])
    expect(routeModule.openApi.methods.POST?.responses.map((response) => response.status)).toEqual([
      200,
      400,
      401,
      403,
      409,
    ])
  })
})
