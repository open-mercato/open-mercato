/** @jest-environment node */

import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { SalesOrder, SalesPayment, SalesPaymentAllocation } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn().mockReturnValue({
    createForFeature: jest.fn().mockResolvedValue(undefined),
  }),
}))

jest.mock('../../notifications', () => ({
  notificationTypes: [],
}))

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn().mockResolvedValue(null),
}))

jest.mock('../shared', () => {
  const actual = jest.requireActual('../shared')
  return { ...actual, enforceSalesDocumentOptimisticLock: jest.fn().mockResolvedValue(undefined) }
})

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const FOREIGN_TENANT = '33333333-3333-4333-8333-333333333333'
const PAYMENT_ID = '44444444-4444-4444-8444-444444444444'
const ORDER_A = 'a0000000-0000-4000-8000-00000000000a'
const ORDER_B = 'b0000000-0000-4000-8000-00000000000b'
const ORDER_C = 'c0000000-0000-4000-8000-00000000000c'
const ORDER_D = 'd0000000-0000-4000-8000-00000000000d'
const ORDER_FOREIGN = 'f0000000-0000-4000-8000-00000000000f'

type OrderRow = { id: string; tenantId: string; organizationId: string; grandTotalGrossAmount: string; paymentMethodId: string | null; updatedAt: Date }
type AllocationRow = { id: string; order: string | null; payment: { id: string }; amount: string; organizationId: string; tenantId: string }

type Call = { kind: 'lock' | 'findOne' | 'find' | 'remove' | 'flush'; entity?: unknown; filter?: Record<string, unknown>; opts?: Record<string, unknown> }

type World = {
  orders: Map<string, OrderRow>
  payment: Record<string, unknown> | null
  allocationReads: AllocationRow[][]
  calls: Call[]
}

function order(id: string, tenantId = TENANT): OrderRow {
  return { id, tenantId, organizationId: ORG, grandTotalGrossAmount: '100', paymentMethodId: null, updatedAt: new Date() }
}

function allocation(orderId: string | null, index: number): AllocationRow {
  return { id: `alloc-${index}`, order: orderId, payment: { id: PAYMENT_ID }, amount: '10', organizationId: ORG, tenantId: TENANT }
}

function buildWorld(allocationReads: AllocationRow[][] = [], payment: Record<string, unknown> | null = null): World {
  const orders = new Map<string, OrderRow>()
  for (const id of [ORDER_A, ORDER_B, ORDER_C, ORDER_D]) orders.set(id, order(id))
  orders.set(ORDER_FOREIGN, order(ORDER_FOREIGN, FOREIGN_TENANT))
  return { orders, payment, allocationReads, calls: [] }
}

function buildEm(world: World) {
  let allocationReadIndex = 0
  const em = {
    findOne: jest.fn(async (entity: unknown, filter: Record<string, unknown>, opts?: Record<string, unknown>) => {
      const kind = opts?.lockMode ? 'lock' : 'findOne'
      world.calls.push({ kind, entity, filter, opts })
      if (entity === SalesPayment) return world.payment
      if (entity === SalesOrder) {
        const row = world.orders.get(String(filter.id).toLowerCase())
        if (!row) return null
        if (filter.tenantId !== undefined && filter.tenantId !== row.tenantId) return null
        if (filter.organizationId !== undefined && filter.organizationId !== row.organizationId) return null
        return row
      }
      return null
    }),
    find: jest.fn(async (entity: unknown, filter: Record<string, unknown>) => {
      world.calls.push({ kind: 'find', entity, filter })
      if (entity === SalesPaymentAllocation && 'payment' in filter) {
        const reads = world.allocationReads
        const read = reads[Math.min(allocationReadIndex, reads.length - 1)] ?? []
        allocationReadIndex += 1
        return read
      }
      return []
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: data.id ?? PAYMENT_ID, ...data })),
    persist: jest.fn(),
    remove: jest.fn((entity: unknown) => world.calls.push({ kind: 'remove', entity: entity })),
    flush: jest.fn(async () => { world.calls.push({ kind: 'flush' }) }),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    transactional: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(em)),
  }
  return em
}

function buildCtx(em: unknown) {
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => em }
      if (name === 'dataEngine') return {}
      return {}
    }),
  }
  return {
    container,
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    request: {} as Request,
    organizationScope: null,
  }
}

function lockedOrderIds(world: World): string[] {
  return world.calls
    .filter((call) => call.kind === 'lock' && call.entity === SalesOrder)
    .map((call) => String(call.filter?.id))
}

function recomputedOrderIds(world: World): string[] {
  return world.calls
    .filter((call) => call.kind === 'find' && call.entity === SalesPaymentAllocation && call.filter && 'order' in call.filter)
    .map((call) => String(call.filter?.order))
}

function invalidatedOrderIds(): string[] {
  return (invalidateCrudCache as jest.Mock).mock.calls
    .filter((args) => args[1] === 'sales.order')
    .map((args) => String(args[2]?.id))
}

function snapshot(orderId: string | null, allocationOrderIds: Array<string | null>) {
  return {
    id: PAYMENT_ID,
    orderId,
    organizationId: ORG,
    tenantId: TENANT,
    paymentMethodId: null,
    paymentReference: null,
    statusEntryId: null,
    status: null,
    amount: 100,
    currencyCode: 'USD',
    capturedAmount: 0,
    refundedAmount: 0,
    receivedAt: null,
    capturedAt: null,
    metadata: null,
    allocations: allocationOrderIds.map((id, index) => ({
      id: `snap-${index}`,
      orderId: id,
      invoiceId: null,
      amount: 10,
      currencyCode: 'USD',
      metadata: null,
    })),
  }
}

function livePayment(primaryOrderId: string | null) {
  return {
    id: PAYMENT_ID,
    organizationId: ORG,
    tenantId: TENANT,
    amount: '100',
    currencyCode: 'USD',
    order: primaryOrderId ? { id: primaryOrderId, organizationId: ORG, tenantId: TENANT } : null,
  }
}

function expectLocksScopedAndOrdered(world: World) {
  const lockCalls = world.calls.filter((call) => call.kind === 'lock' && call.entity === SalesOrder)
  for (const call of lockCalls) {
    expect(call.filter).toMatchObject({ organizationId: ORG, tenantId: TENANT })
    expect(call.opts).toMatchObject({ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
  }
  const ids = lockCalls.map((call) => String(call.filter?.id))
  expect(new Set(ids).size).toBe(ids.length)
  return ids
}


beforeEach(() => {
  ;(invalidateCrudCache as jest.Mock).mockClear()
  ;(findOneWithDecryption as jest.Mock).mockReset()
  ;(findWithDecryption as jest.Mock).mockReset()
  ;(findOneWithDecryption as jest.Mock).mockImplementation((em, entity, where, opts) => em.findOne(entity, where, opts))
  ;(findWithDecryption as jest.Mock).mockImplementation((em, entity, where, opts) => em.find(entity, where, opts))
})

beforeAll(async () => {
  await import('../payments')
})

describe('sales.payments.create — secondary allocation orders', () => {
  it('locks primary and every allocation order in ascending id order before writing, recomputes and invalidates each', async () => {
    const world = buildWorld()
    const em = buildEm(world)
    const execute = commandRegistry.get('sales.payments.create')!.execute
    const result = await execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        orderId: ORDER_C,
        amount: 100,
        currencyCode: 'USD',
        allocations: [
          { orderId: ORDER_B, amount: 60, currencyCode: 'USD' },
          { orderId: ORDER_A, amount: 40, currencyCode: 'USD' },
        ],
      },
      buildCtx(em) as any,
    )
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_B, ORDER_C])
    const firstLock = world.calls.findIndex((call) => call.kind === 'lock')
    const firstFlush = world.calls.findIndex((call) => call.kind === 'flush')
    expect(firstLock).toBeLessThan(firstFlush)
    expect(recomputedOrderIds(world).sort()).toEqual([ORDER_A, ORDER_B, ORDER_C])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_A, ORDER_B, ORDER_C])
    expect(result).toMatchObject({ paymentId: PAYMENT_ID, orderTotals: { paidTotalAmount: 0 } })
  })

  it('de-duplicates allocation order ids case-insensitively and locks each order once', async () => {
    const world = buildWorld()
    const em = buildEm(world)
    await commandRegistry.get('sales.payments.create')!.execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        orderId: ORDER_B,
        amount: 30,
        currencyCode: 'USD',
        allocations: [
          { orderId: ORDER_B.toUpperCase(), amount: 10, currencyCode: 'USD' },
          { orderId: ORDER_A, amount: 10, currencyCode: 'USD' },
          { orderId: ORDER_A.toUpperCase(), amount: 10, currencyCode: 'USD' },
        ],
      },
      buildCtx(em) as any,
    )
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_B])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_A, ORDER_B])
  })

  it('without explicit allocations refreshes only the primary order', async () => {
    const world = buildWorld()
    const em = buildEm(world)
    await commandRegistry.get('sales.payments.create')!.execute(
      { tenantId: TENANT, organizationId: ORG, orderId: ORDER_B, amount: 10, currencyCode: 'USD' },
      buildCtx(em) as any,
    )
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_B])
    expect(invalidatedOrderIds()).toEqual([ORDER_B])
  })

  it('rejects a cross-tenant allocation order; its lock query is scope-filtered and it is never invalidated', async () => {
    const world = buildWorld()
    const em = buildEm(world)
    await expect(
      commandRegistry.get('sales.payments.create')!.execute(
        {
          tenantId: TENANT,
          organizationId: ORG,
          orderId: ORDER_A,
          amount: 20,
          currencyCode: 'USD',
          allocations: [
            { orderId: ORDER_A, amount: 10, currencyCode: 'USD' },
            { orderId: ORDER_FOREIGN, amount: 10, currencyCode: 'USD' },
          ],
        },
        buildCtx(em) as any,
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_FOREIGN])
    expect(invalidatedOrderIds()).toEqual([])
  })
})

describe('sales.payments.update — before/after order union', () => {
  it('refreshes previous primary, new primary, removed and added allocation orders', async () => {
    const world = buildWorld([[allocation(ORDER_A, 1), allocation(ORDER_B, 2)]], livePayment(ORDER_A))
    const em = buildEm(world)
    const result = await commandRegistry.get('sales.payments.update')!.execute(
      {
        id: PAYMENT_ID,
        tenantId: TENANT,
        organizationId: ORG,
        orderId: ORDER_D,
        allocations: [
          { orderId: ORDER_D, amount: 70, currencyCode: 'USD' },
          { orderId: ORDER_C, amount: 30, currencyCode: 'USD' },
        ],
      },
      buildCtx(em) as any,
    )
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_B, ORDER_C, ORDER_D])
    expect(recomputedOrderIds(world).sort()).toEqual([ORDER_A, ORDER_B, ORDER_C, ORDER_D])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_A, ORDER_B, ORDER_C, ORDER_D])
    expect(result).toMatchObject({ paymentId: PAYMENT_ID, orderTotals: { outstandingAmount: 100 } })
  })

  it('also locks an allocation order that appears only after the first locks were taken', async () => {
    const world = buildWorld(
      [[allocation(ORDER_B, 1)], [allocation(ORDER_B, 1), allocation(ORDER_D, 2)]],
      livePayment(ORDER_B),
    )
    const em = buildEm(world)
    await commandRegistry.get('sales.payments.update')!.execute(
      { id: PAYMENT_ID, tenantId: TENANT, organizationId: ORG, allocations: [{ orderId: ORDER_A, amount: 10, currencyCode: 'USD' }] },
      buildCtx(em) as any,
    )
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_B, ORDER_D])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_A, ORDER_B, ORDER_D])
  })

  it('a scalar-only update still refreshes existing secondary allocation orders', async () => {
    const world = buildWorld([[allocation(ORDER_A, 1), allocation(ORDER_C, 2)]], livePayment(ORDER_A))
    const em = buildEm(world)
    await commandRegistry.get('sales.payments.update')!.execute(
      { id: PAYMENT_ID, tenantId: TENANT, organizationId: ORG, paymentReference: 'ref' },
      buildCtx(em) as any,
    )
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_C])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_A, ORDER_C])
  })

  it('never locks or invalidates a cross-tenant allocation order', async () => {
    const world = buildWorld([[allocation(ORDER_A, 1), allocation(ORDER_FOREIGN, 2)]], livePayment(ORDER_A))
    const em = buildEm(world)
    await commandRegistry.get('sales.payments.update')!.execute(
      { id: PAYMENT_ID, tenantId: TENANT, organizationId: ORG, paymentReference: 'ref' },
      buildCtx(em) as any,
    )
    expectLocksScopedAndOrdered(world)
    expect(invalidatedOrderIds()).toEqual([ORDER_A])
  })
})

describe('sales.payments.delete — every allocation order', () => {
  it('locks before removing, recomputes and invalidates primary and secondary orders, returns primary totals', async () => {
    const world = buildWorld([[allocation(ORDER_C, 1), allocation(ORDER_A, 2)]], livePayment(ORDER_C))
    const em = buildEm(world)
    const result = await commandRegistry.get('sales.payments.delete')!.execute(
      { id: PAYMENT_ID, tenantId: TENANT, organizationId: ORG },
      buildCtx(em) as any,
    )
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_C])
    const lastLock = world.calls.map((call) => call.kind).lastIndexOf('lock')
    const firstRemove = world.calls.findIndex((call) => call.kind === 'remove')
    expect(lastLock).toBeLessThan(firstRemove)
    expect(recomputedOrderIds(world).sort()).toEqual([ORDER_A, ORDER_C])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_A, ORDER_C])
    expect(result).toMatchObject({ paymentId: PAYMENT_ID, orderTotals: { outstandingAmount: 100 } })
  })
})

describe('payment undo/redo — affected order union', () => {
  it('undo create removes the payment and refreshes live and snapshot orders', async () => {
    const world = buildWorld([[allocation(ORDER_B, 1), allocation(ORDER_D, 2)]], livePayment(ORDER_B))
    const em = buildEm(world)
    const after = snapshot(ORDER_B, [ORDER_B, ORDER_C])
    await commandRegistry.get('sales.payments.create')!.undo!({
      logEntry: { commandPayload: { undo: { after, orderPaymentMethodIdBefore: null, orderPaymentMethodCodeBefore: null } } } as any,
      ctx: buildCtx(em) as any,
    })
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_B, ORDER_C, ORDER_D])
    expect(recomputedOrderIds(world).sort()).toEqual([ORDER_B, ORDER_C, ORDER_D])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_B, ORDER_C, ORDER_D])
  })

  it('undo create is a no-op when the payment is already gone', async () => {
    const world = buildWorld([], null)
    const em = buildEm(world)
    await commandRegistry.get('sales.payments.create')!.undo!({
      logEntry: { commandPayload: { undo: { after: snapshot(ORDER_A, [ORDER_A, ORDER_B]) } } } as any,
      ctx: buildCtx(em) as any,
    })
    expect(lockedOrderIds(world)).toEqual([])
    expect(invalidatedOrderIds()).toEqual([])
  })

  it('redo create refreshes every order of the restored snapshot', async () => {
    const world = buildWorld([[]], null)
    const em = buildEm(world)
    const after = snapshot(ORDER_C, [ORDER_C, ORDER_A])
    const result = await commandRegistry.get('sales.payments.create')!.redo!({
      logEntry: { commandPayload: { undo: { after } } } as any,
      ctx: buildCtx(em) as any,
    } as any)
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_C])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_A, ORDER_C])
    expect(result).toMatchObject({ paymentId: PAYMENT_ID })
  })

  it('undo update refreshes before-state, after-state and live allocation orders', async () => {
    const world = buildWorld([[allocation(ORDER_D, 1)]], livePayment(ORDER_D))
    const em = buildEm(world)
    const before = snapshot(ORDER_A, [ORDER_A, ORDER_B])
    const after = snapshot(ORDER_D, [ORDER_D, ORDER_C])
    await commandRegistry.get('sales.payments.update')!.undo!({
      logEntry: { commandPayload: { undo: { before, after } } } as any,
      ctx: buildCtx(em) as any,
    })
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_B, ORDER_C, ORDER_D])
    expect(recomputedOrderIds(world).sort()).toEqual([ORDER_A, ORDER_B, ORDER_C, ORDER_D])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_A, ORDER_B, ORDER_C, ORDER_D])
  })

  it('undo delete refreshes the primary and every secondary order of the restored payment', async () => {
    const world = buildWorld([[]], null)
    const em = buildEm(world)
    const before = snapshot(ORDER_A, [ORDER_A, ORDER_B, ORDER_C])
    await commandRegistry.get('sales.payments.delete')!.undo!({
      logEntry: { commandPayload: { undo: { before } } } as any,
      ctx: buildCtx(em) as any,
    })
    expect(expectLocksScopedAndOrdered(world)).toEqual([ORDER_A, ORDER_B, ORDER_C])
    expect(recomputedOrderIds(world).sort()).toEqual([ORDER_A, ORDER_B, ORDER_C])
    expect(invalidatedOrderIds().sort()).toEqual([ORDER_A, ORDER_B, ORDER_C])
  })

  it('undo never locks or invalidates a cross-tenant order referenced by a tampered snapshot', async () => {
    const world = buildWorld([[]], null)
    const em = buildEm(world)
    const before = snapshot(ORDER_A, [ORDER_A, ORDER_FOREIGN])
    await commandRegistry.get('sales.payments.delete')!.undo!({
      logEntry: { commandPayload: { undo: { before } } } as any,
      ctx: buildCtx(em) as any,
    })
    expectLocksScopedAndOrdered(world)
    expect(invalidatedOrderIds()).toEqual([ORDER_A])
  })
})
