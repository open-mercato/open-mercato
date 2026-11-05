/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { LockMode } from '@mikro-orm/core'
import { SalesOrder, SalesPayment } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

// The encrypted-entity reads now go through findOneWithDecryption / findWithDecryption
// (issue #2112). The mocks delegate transparently to the EntityManager passed as the
// first argument, so the existing scope-aware `findOne` capture below still observes the
// #2111 lock queries (WHERE scope + PESSIMISTIC_WRITE) exactly as when they were raw reads.
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

const TENANT_T1 = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_O1 = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const PAYMENT_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const ORDER_NEXT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORDER_PREV = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

type FindOneCall = {
  entity: unknown
  filter: Record<string, unknown>
  opts: Record<string, unknown> | undefined
}

// The payment + allocations the EntityManager mock should serve for the current test.
// The decryption-helper mocks delegate to the EM, so these flow through that path.
let currentPayment: Record<string, unknown> | null = null
let currentAllocations: Array<Record<string, unknown>> = []

// findOneWithDecryption / findWithDecryption delegate to the EM passed in, so reads keep
// hitting the scope-aware capture in `buildEmCapturingFindOne`.
function installDecryptionDelegation() {
  ;(findOneWithDecryption as jest.Mock).mockImplementation(
    (em: { findOne: (...args: unknown[]) => unknown }, entity: unknown, where: unknown, opts?: unknown) =>
      em.findOne(entity, where, opts),
  )
  ;(findWithDecryption as jest.Mock).mockImplementation(
    (em: { find: (...args: unknown[]) => unknown }, entity: unknown, where: unknown, opts?: unknown) =>
      em.find(entity, where, opts),
  )
}

function buildPayment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PAYMENT_ID,
    organizationId: ORG_O1,
    tenantId: TENANT_T1,
    amount: '100',
    currencyCode: 'USD',
    order: { id: ORDER_NEXT, organizationId: ORG_O1, tenantId: TENANT_T1 },
    paymentMethodId: null,
    paymentReference: null,
    metadata: null,
    receivedAt: null,
    capturedAt: null,
    ...overrides,
  }
}

function buildScopedOrder(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    organizationId: ORG_O1,
    tenantId: TENANT_T1,
    paymentMethodId: null,
    paymentMethodCode: null,
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    outstandingAmount: '0',
    currencyCode: 'USD',
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildEmCapturingFindOne(captures: FindOneCall[], opts: { validOrderIds?: ReadonlySet<string> } = {}) {
  const validOrderIds = opts.validOrderIds ?? new Set([ORDER_NEXT, ORDER_PREV])
  const findOne = jest.fn().mockImplementation((entity, filter, queryOpts) => {
    captures.push({ entity, filter, opts: queryOpts })
    if (entity === SalesPayment) return Promise.resolve(currentPayment)
    // `validOrderIds` models which order rows exist in the caller's scope; a foreign
    // row sits outside it and reads back as null. The #2111 lock queries still carry
    // org/tenant in their WHERE — that is asserted directly against the captured
    // filters below, independent of what this stub returns.
    if (entity === SalesOrder && typeof filter?.id === 'string' && validOrderIds.has(filter.id)) {
      return Promise.resolve(buildScopedOrder(filter.id))
    }
    return Promise.resolve(null)
  })
  const find = jest.fn().mockImplementation(() => Promise.resolve(currentAllocations))
  const flush = jest.fn().mockResolvedValue(undefined)
  const persist = jest.fn()
  const remove = jest.fn()
  const create = jest.fn()
  const transactional = jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      findOne,
      find,
      flush,
      persist,
      remove,
      create,
    }
    return cb(tx)
  })
  return { findOne, find, flush, persist, remove, create, transactional }
}

function buildCtxFor(em: Record<string, unknown>) {
  const container = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      if (name === 'dataEngine') return {}
      return {}
    }),
  }
  return {
    container,
    auth: { tenantId: TENANT_T1, orgId: ORG_O1 },
    selectedOrganizationId: ORG_O1,
    organizationIds: [ORG_O1],
    request: {} as Request,
    organizationScope: null,
  }
}

beforeAll(async () => {
  commandRegistry.clear?.()
  await import('../payments')
})

describe('sales.payments.update — recomputeOrderPaymentTotals scope guard (#2111)', () => {
  beforeEach(() => {
    currentPayment = null
    currentAllocations = []
    ;(findOneWithDecryption as jest.Mock).mockReset()
    ;(findWithDecryption as jest.Mock).mockReset()
    ;(invalidateCrudCache as jest.Mock).mockClear()
    installDecryptionDelegation()
  })

  it('locks the next order with organizationId + tenantId in the WHERE clause (defence-in-depth)', async () => {
    const execute = commandRegistry.get('sales.payments.update')?.execute
    expect(execute).toBeInstanceOf(Function)

    const captures: FindOneCall[] = []
    const em = buildEmCapturingFindOne(captures)

    currentPayment = buildPayment()
    currentAllocations = []

    const ctx = buildCtxFor(em)
    await execute?.(
      { id: PAYMENT_ID, tenantId: TENANT_T1, organizationId: ORG_O1 },
      ctx as any,
    )

    const salesOrderCalls = captures.filter((c) => c.entity === SalesOrder)
    expect(salesOrderCalls.length).toBeGreaterThan(0)
    for (const call of salesOrderCalls) {
      expect(call.filter).toMatchObject({
        organizationId: ORG_O1,
        tenantId: TENANT_T1,
      })
    }
  })

  it('passes PESSIMISTIC_WRITE lock on the next-order findOne (lock semantics preserved)', async () => {
    const execute = commandRegistry.get('sales.payments.update')?.execute
    const captures: FindOneCall[] = []
    const em = buildEmCapturingFindOne(captures)
    currentPayment = buildPayment()
    currentAllocations = []

    await execute?.(
      { id: PAYMENT_ID, tenantId: TENANT_T1, organizationId: ORG_O1 },
      buildCtxFor(em) as any,
    )

    const lockedCalls = captures.filter(
      (c) => c.entity === SalesOrder && c.opts?.lockMode === LockMode.PESSIMISTIC_WRITE,
    )
    expect(lockedCalls.length).toBeGreaterThan(0)
    for (const call of lockedCalls) {
      expect(call.filter).toMatchObject({
        organizationId: ORG_O1,
        tenantId: TENANT_T1,
      })
    }
  })

  it('cross-scope order id (tampered): findOne returns null, recompute skipped, cache NOT invalidated', async () => {
    const execute = commandRegistry.get('sales.payments.update')?.execute
    const captures: FindOneCall[] = []
    // Pre-fix simulation: payment.order references a foreign-tenant row. Empty
    // validOrderIds models the DB row at that id sitting in a foreign scope —
    // so the scoped findOne returns null even though the filter matches `id`.
    const em = buildEmCapturingFindOne(captures, { validOrderIds: new Set() })

    const foreignOrderId = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'
    currentPayment = buildPayment({
      order: { id: foreignOrderId, organizationId: 'foreign-org', tenantId: 'foreign-tenant' },
    })
    currentAllocations = []

    await execute?.(
      { id: PAYMENT_ID, tenantId: TENANT_T1, organizationId: ORG_O1 },
      buildCtxFor(em) as any,
    )

    const lockCallsForForeign = captures.filter(
      (c) =>
        c.entity === SalesOrder &&
        c.filter?.id === foreignOrderId &&
        c.opts?.lockMode === LockMode.PESSIMISTIC_WRITE,
    )
    expect(lockCallsForForeign.length).toBeGreaterThan(0)
    for (const call of lockCallsForForeign) {
      expect(call.filter).toMatchObject({
        organizationId: ORG_O1,
        tenantId: TENANT_T1,
      })
    }
    expect(invalidateCrudCache as jest.Mock).not.toHaveBeenCalled()
  })

  it('previous-order lock includes scope filter (#2111 site L947)', async () => {
    const execute = commandRegistry.get('sales.payments.update')?.execute
    const captures: FindOneCall[] = []
    const em = buildEmCapturingFindOne(captures)

    currentPayment = buildPayment({
      order: { id: ORDER_PREV, organizationId: ORG_O1, tenantId: TENANT_T1 },
    })
    currentAllocations = []

    await execute?.(
      { id: PAYMENT_ID, tenantId: TENANT_T1, organizationId: ORG_O1, orderId: ORDER_NEXT },
      buildCtxFor(em) as any,
    )

    const previousOrderCalls = captures.filter(
      (c) => c.entity === SalesOrder && c.filter?.id === ORDER_PREV,
    )
    expect(previousOrderCalls.length).toBeGreaterThan(0)
    for (const call of previousOrderCalls) {
      expect(call.filter).toMatchObject({
        organizationId: ORG_O1,
        tenantId: TENANT_T1,
      })
    }
  })
})

describe('sales.payments.delete — recomputeOrderPaymentTotals scope guard (#2111)', () => {
  beforeEach(() => {
    currentPayment = null
    currentAllocations = []
    ;(findOneWithDecryption as jest.Mock).mockReset()
    ;(findWithDecryption as jest.Mock).mockReset()
    ;(invalidateCrudCache as jest.Mock).mockClear()
    installDecryptionDelegation()
  })

  it('locks every allocation order with organizationId + tenantId in the WHERE clause', async () => {
    const execute = commandRegistry.get('sales.payments.delete')?.execute
    expect(execute).toBeInstanceOf(Function)

    const captures: FindOneCall[] = []
    const em = buildEmCapturingFindOne(captures)

    currentPayment = buildPayment()
    currentAllocations = [
      { id: 'alloc-1', order: ORDER_NEXT, payment: currentPayment, organizationId: ORG_O1, tenantId: TENANT_T1 },
    ]

    await execute?.(
      { id: PAYMENT_ID, tenantId: TENANT_T1, organizationId: ORG_O1 },
      buildCtxFor(em) as any,
    )

    const salesOrderCalls = captures.filter((c) => c.entity === SalesOrder)
    expect(salesOrderCalls.length).toBeGreaterThan(0)
    for (const call of salesOrderCalls) {
      expect(call.filter).toMatchObject({
        organizationId: ORG_O1,
        tenantId: TENANT_T1,
      })
    }
  })

  it('cross-scope allocation order id: findOne returns null, cache NOT invalidated', async () => {
    const execute = commandRegistry.get('sales.payments.delete')?.execute
    const captures: FindOneCall[] = []
    // Same setup as the update cross-scope test: empty validOrderIds models the
    // foreign-tenant order at the allocation's order id.
    const em = buildEmCapturingFindOne(captures, { validOrderIds: new Set() })

    const foreignOrderId = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'
    currentPayment = buildPayment()
    currentAllocations = [
      { id: 'alloc-1', order: foreignOrderId, payment: currentPayment, organizationId: ORG_O1, tenantId: TENANT_T1 },
    ]

    await execute?.(
      { id: PAYMENT_ID, tenantId: TENANT_T1, organizationId: ORG_O1 },
      buildCtxFor(em) as any,
    )

    const lockCallsForForeign = captures.filter(
      (c) =>
        c.entity === SalesOrder &&
        c.filter?.id === foreignOrderId &&
        c.opts?.lockMode === LockMode.PESSIMISTIC_WRITE,
    )
    expect(lockCallsForForeign.length).toBeGreaterThan(0)
    for (const call of lockCallsForForeign) {
      expect(call.filter).toMatchObject({
        organizationId: ORG_O1,
        tenantId: TENANT_T1,
      })
    }
    expect(invalidateCrudCache as jest.Mock).not.toHaveBeenCalled()
  })
})
