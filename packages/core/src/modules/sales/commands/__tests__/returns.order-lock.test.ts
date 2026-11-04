/** @jest-environment node */

import { LockMode } from '@mikro-orm/core'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { SalesOrder, SalesOrderLine } from '../../data/entities'

jest.mock('../../services/salesDocumentNumberGenerator', () => ({
  SalesDocumentNumberGenerator: class {
    async generate() {
      return { number: 'RET-LOCK-0001' }
    }
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({ invalidateCrudCache: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const SHIPMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const RETURN_ID = '11111111-1111-4111-8111-111111111111'
const RETURN_LINE_ID = '22222222-2222-4222-8222-222222222222'
const ADJUSTMENT_ID = '33333333-3333-4333-8333-333333333333'

type EntityConstructor = { name: string }
type QueryOptions = { refresh?: boolean; lockMode?: LockMode }
type LockPredicate = { column: string; operator: string; value: unknown }
type LockRecord = { table: string; predicates: LockPredicate[]; noKeyUpdate: boolean }
type LockQuery = {
  select: (column: string) => LockQuery
  where: (column: string, operator: string, value: unknown) => LockQuery
  forNoKeyUpdate: () => LockQuery
  executeTakeFirst: () => Promise<{ id: string } | undefined>
}
type MockState = {
  trace: string[]
  locks: LockRecord[]
  lockedOrderExists: boolean
  order: SalesOrder
  orderLine: SalesOrderLine
}

const mockState: MockState = {
  trace: [],
  locks: [],
  lockedOrderExists: true,
  order: new SalesOrder(),
  orderLine: new SalesOrderLine(),
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: EntityConstructor, _where: unknown, options?: QueryOptions) => {
    if (entity.name === 'SalesOrder') {
      mockState.trace.push(options?.refresh ? 'order-refresh' : 'order-read')
      return mockState.lockedOrderExists || !options?.refresh ? mockState.order : null
    }
    if (entity.name === 'SalesReturn') {
      mockState.trace.push('return-read')
      return { id: RETURN_ID, organizationId: ORG_ID, tenantId: TENANT_ID }
    }
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entity: EntityConstructor, _where: unknown, options?: QueryOptions) => {
    mockState.trace.push(`${entity.name}:${options?.lockMode === LockMode.PESSIMISTIC_WRITE ? 'for-update' : 'read'}`)
    if (entity.name === 'SalesOrderLine') return [mockState.orderLine]
    if (entity.name === 'SalesShipment') return [{ id: SHIPMENT_ID }]
    if (entity.name === 'SalesShipmentItem') {
      return [{ shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: '3' }]
    }
    return []
  }),
}))

function resetState() {
  mockState.trace = []
  mockState.locks = []
  mockState.lockedOrderExists = true
  mockState.order = Object.assign(new SalesOrder(), {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    currencyCode: 'USD',
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    updatedAt: new Date('2026-10-05T10:00:00.000Z'),
  })
  mockState.orderLine = Object.assign(new SalesOrderLine(), {
    id: LINE_ID,
    quantity: '3',
    returnedQuantity: '1',
    totalNetAmount: '300',
    totalGrossAmount: '300',
    unitPriceNet: '100',
    unitPriceGross: '100',
  })
}

function makeEm() {
  let active = false
  const em = {
    fork: () => em,
    transactional: async (work: (trx: unknown) => Promise<unknown>) => {
      mockState.trace.push('transaction')
      return work(em)
    },
    begin: async () => { active = true; mockState.trace.push('transaction') },
    commit: async () => { active = false; mockState.trace.push('commit') },
    rollback: async () => { active = false; mockState.trace.push('rollback') },
    isInTransaction: () => active,
    getKysely: () => ({
      selectFrom: (table: string) => {
        const record: LockRecord = { table, predicates: [], noKeyUpdate: false }
        mockState.locks.push(record)
        const query: LockQuery = {
          select: () => query,
          where: (column, operator, value) => { record.predicates.push({ column, operator, value }); return query },
          forNoKeyUpdate: () => { record.noKeyUpdate = true; return query },
          executeTakeFirst: async () => {
            mockState.trace.push('order-lock')
            return mockState.lockedOrderExists ? { id: ORDER_ID } : undefined
          },
        }
        return query
      },
    }),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => {}),
    getReference: (_entity: unknown, id: string) => ({ id }),
    getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }),
  }
  return em
}

function makeCtx(calculateDocumentTotals: jest.Mock) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(makeEm()),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesCalculationService: asValue({ calculateDocumentTotals }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/sales/returns', { method: 'POST' }),
  }
}

function returnSnapshot() {
  return {
    id: RETURN_ID,
    orderId: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    returnNumber: 'RET-LOCK-0001',
    returnedAt: null,
    reason: null,
    notes: null,
    lines: [{
      id: RETURN_LINE_ID,
      orderLineId: LINE_ID,
      quantityReturned: 1,
      unitPriceNet: 100,
      unitPriceGross: 100,
      totalNetAmount: 100,
      totalGrossAmount: 100,
    }],
    adjustmentIds: [ADJUSTMENT_ID],
  }
}

function calculation() {
  return jest.fn(async () => ({ totals: {}, lines: [{}] }))
}

function expectScopedOrderLock() {
  expect(mockState.locks).toEqual([{
    table: 'sales_orders',
    noKeyUpdate: true,
    predicates: [
      { column: 'id', operator: '=', value: ORDER_ID },
      { column: 'tenant_id', operator: '=', value: TENANT_ID },
      { column: 'organization_id', operator: '=', value: ORG_ID },
      { column: 'deleted_at', operator: 'is', value: null },
    ],
  }])
}

function expectLockedBefore(event: string) {
  const lockedAt = mockState.trace.indexOf('order-lock')
  expect(lockedAt).toBeGreaterThan(mockState.trace.indexOf('transaction'))
  expect(mockState.trace.indexOf('order-refresh')).toBeGreaterThan(lockedAt)
  expect(mockState.trace.indexOf(event)).toBeGreaterThan(lockedAt)
}

describe('sales return commands take the parent order lock before the order lines (#6463)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../returns')
  })

  beforeEach(resetState)

  it('locks the scoped order before locking lines when a return is created', async () => {
    const totals = calculation()
    await commandRegistry.get('sales.returns.create')!.execute({
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      lines: [{ orderLineId: LINE_ID, quantity: 1 }],
    }, makeCtx(totals) as never)
    expectScopedOrderLock()
    expectLockedBefore('SalesOrderLine:for-update')
    expect(totals).toHaveBeenCalledTimes(1)
  })

  it('locks the scoped order before reading lines when a return is undone', async () => {
    const totals = calculation()
    await commandRegistry.get('sales.returns.create')!.undo!({
      logEntry: { commandPayload: { undo: { after: returnSnapshot() } } },
      ctx: makeCtx(totals),
    } as never)
    expectScopedOrderLock()
    expectLockedBefore('SalesOrderLine:read')
    expect(totals).toHaveBeenCalledTimes(1)
  })

  it('leaves the return untouched when no live order can be locked during undo', async () => {
    mockState.lockedOrderExists = false
    const totals = calculation()
    await commandRegistry.get('sales.returns.create')!.undo!({
      logEntry: { commandPayload: { undo: { after: returnSnapshot() } } },
      ctx: makeCtx(totals),
    } as never)
    expect(mockState.trace).not.toContain('SalesOrderLine:read')
    expect(mockState.trace).not.toContain('return-read')
    expect(totals).not.toHaveBeenCalled()
  })

  it('locks the scoped order before locking lines when a return is redone', async () => {
    const totals = calculation()
    await commandRegistry.get('sales.returns.create')!.redo!({
      logEntry: { commandPayload: { undo: { after: returnSnapshot() } } },
      ctx: makeCtx(totals),
    } as never)
    expectScopedOrderLock()
    expectLockedBefore('SalesOrderLine:for-update')
    expect(totals).toHaveBeenCalledTimes(1)
  })
})
