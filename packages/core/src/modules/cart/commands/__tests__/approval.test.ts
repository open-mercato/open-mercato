jest.mock('../../events', () => ({
  emitCartEvent: jest.fn(async () => undefined),
}))

type FakeRow = Record<string, any>

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (value && typeof value === 'object' && !(value instanceof Date) && '$in' in (value as object)) {
      return ((value as { $in: unknown[] }).$in).includes(row[key])
    }
    return row[key] === value
  })
}

let seededCarts: FakeRow[] = []

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === Cart) return seededCarts.find((row) => matchesWhere(row, where)) ?? null
  throw new Error('[internal] unexpected findOneWithDecryption entity in test')
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerPurchaseApprovalServiceError } from '@open-mercato/core/modules/customer_groups/services/customerPurchaseApprovalService'
import { Cart } from '../../data/entities'
import { emitCartEvent as mockedEmitCartEvent } from '../../events'
import type { CartRequestApprovalInput, CartRequestApprovalResult } from '../approval'
import '../approval'

const emitCartEventMock = mockedEmitCartEvent as jest.Mock

const TENANT_ID = 'tenant-approval-1'
const ORG_ID = 'org-approval-1'
const CART_ID = 'cart-1'

function makeCartFixture(overrides: FakeRow = {}): FakeRow {
  const now = new Date('2026-03-01T00:00:00.000Z')
  return {
    id: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    channel: 'storefront',
    kind: 'basket',
    status: 'active',
    currencyCode: 'USD',
    locale: 'en-US',
    customerId: 'customer-1',
    customerIds: ['customer-1'],
    customerUserId: 'buyer-1',
    customerGroupIds: [],
    priceKindId: null,
    taxMode: 'gross',
    totals: {
      subtotalNetAmount: 0,
      subtotalGrossAmount: 0,
      discountTotalAmount: 0,
      taxTotalAmount: 0,
      grandTotalNetAmount: 50,
      grandTotalGrossAmount: 50,
    },
    requiresApproval: true,
    approvalId: null,
    awaitingApprovalSince: null,
    checkoutSessionId: null,
    lockedAt: null,
    lockExpiresAt: null,
    resolvedAt: null,
    lastActivityAt: now,
    expiresAt: new Date('2026-03-08T00:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeEm() {
  const em: any = {
    fork: jest.fn(),
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, data: FakeRow) => {
      if (entity !== Cart) return 0
      const rows = seededCarts.filter((row) => matchesWhere(row, where))
      rows.forEach((row) => Object.assign(row, data))
      return rows.length
    }),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeDataEngine() {
  return { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn(async () => {}) }
}

function makeCustomerGroupsServiceStub(approvalRequiredAbove: number | null, termsCurrencyCode: string | null = 'USD') {
  return {
    resolveTerms: jest.fn(async () => ({
      approvalRequiredAbove,
      termsCurrencyCode,
      approvalPolicy: 'buyer',
    })),
  }
}

function makeApprovalServiceStub(opts: {
  getApproval?: jest.Mock
  requestApproval?: jest.Mock
  withdrawApproval?: jest.Mock
} = {}) {
  return {
    requestApproval: opts.requestApproval ?? jest.fn(),
    getApproval: opts.getApproval ?? jest.fn(async () => null),
    getActiveApprovalForSubject: jest.fn(),
    withdrawApproval: opts.withdrawApproval ?? jest.fn(),
    decideApproval: jest.fn(),
  }
}

function makeCtx(opts: {
  em: unknown
  customerGroupsService?: unknown
  customerPurchaseApprovalService?: unknown
}): CommandRuntimeContext {
  const dataEngine = makeDataEngine()
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return opts.em
        if (token === 'dataEngine') return dataEngine
        if (token === 'customerGroupsService') {
          if (opts.customerGroupsService !== undefined) return opts.customerGroupsService
          throw new Error(`Unexpected DI token: ${token}`)
        }
        if (token === 'customerPurchaseApprovalService') {
          if (opts.customerPurchaseApprovalService !== undefined) return opts.customerPurchaseApprovalService
          throw new Error(`Unexpected DI token: ${token}`)
        }
        throw new Error(`Unexpected DI token: ${token}`)
      },
      register: jest.fn(),
    } as any,
    auth: null,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

function getHandler<I, R>(id: string): CommandHandler<I, R> {
  const handler = commandRegistry.get<I, R>(id)
  if (!handler) throw new Error(`command ${id} not registered`)
  return handler
}

beforeEach(() => {
  jest.clearAllMocks()
  seededCarts = [makeCartFixture()]
})

// Step 3.2 (K3/K4/K7/G8, §9a.4) — `cart.approval.request`.
describe('cart.approval.request', () => {
  const handler = getHandler<CartRequestApprovalInput, CartRequestApprovalResult>('cart.approval.request')

  it('creates a new approval, writes approvalId and awaitingApprovalSince, and emits the full K7 payload', async () => {
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub(10)
    const requestApproval = jest.fn(async () => ({
      approval: { id: 'approval-1', customerId: 'customer-1', amountGross: '50', currencyCode: 'USD', status: 'pending' },
      created: true,
    }))
    const approvalService = makeApprovalServiceStub({ requestApproval })
    const ctx = makeCtx({ em, customerGroupsService, customerPurchaseApprovalService: approvalService })

    const result = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(result.approvalId).toBe('approval-1')
    expect(result.created).toBe(true)
    expect(requestApproval).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      buyer: { customerIds: ['customer-1'] },
      requestedBy: { actorType: 'customer_user', actorId: 'buyer-1', customerEntityId: 'customer-1' },
      subjectType: 'cart',
      subjectId: CART_ID,
      amountGross: '50',
      currencyCode: 'USD',
    })

    const cart = seededCarts[0]
    expect(cart.approvalId).toBe('approval-1')
    expect(cart.awaitingApprovalSince).toBeInstanceOf(Date)

    // K7/§11: the full rev-10 payload — `customerId`/`customerUserId` included, past the
    // narrower 6-field shape the pre-revision analysis finding named (NOTIFY.md decision).
    expect(emitCartEventMock).toHaveBeenCalledWith('cart.approval.requested', {
      cartId: CART_ID,
      approvalId: 'approval-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerId: 'customer-1',
      customerUserId: 'buyer-1',
      amountGross: '50',
      currencyCode: 'USD',
    })
  })

  // Priority 1 — idempotent per pending approval: a repeat call against a pending approval
  // that still covers the cart returns the SAME approval, calls requestApproval exactly
  // once (never again on the repeat), and emits no second event.
  it('is idempotent while the existing approval is pending and still covers the cart', async () => {
    seededCarts = [makeCartFixture({ approvalId: 'approval-1' })]
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub(10)
    const getApproval = jest.fn(async () => ({ id: 'approval-1', status: 'pending', amountGross: '50', currencyCode: 'USD' }))
    const requestApproval = jest.fn()
    const approvalService = makeApprovalServiceStub({ getApproval, requestApproval })
    const ctx = makeCtx({ em, customerGroupsService, customerPurchaseApprovalService: approvalService })

    const first = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    const second = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(first.approvalId).toBe('approval-1')
    expect(second.approvalId).toBe('approval-1')
    expect(first.created).toBe(false)
    expect(second.created).toBe(false)
    expect(requestApproval).not.toHaveBeenCalled()
    expect(emitCartEventMock).not.toHaveBeenCalled()
  })

  // Priority 2 — K4 guest refusal.
  it('refuses a guest cart with 409 approval_requires_identified_buyer', async () => {
    seededCarts = [makeCartFixture({ customerUserId: null })]
    const em = makeEm()
    const ctx = makeCtx({ em, customerGroupsService: makeCustomerGroupsServiceStub(10) })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'approval_requires_identified_buyer' })
  })

  // Priority 3 — 409 approval_not_required when the cart does not need approval.
  it('refuses with 409 approval_not_required when the cart does not need approval', async () => {
    seededCarts = [makeCartFixture()]
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub(null)
    const approvalService = makeApprovalServiceStub()
    const ctx = makeCtx({ em, customerGroupsService, customerPurchaseApprovalService: approvalService })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'approval_not_required' })
    expect(approvalService.requestApproval).not.toHaveBeenCalled()
  })

  // §9a.4 step 2 — an existing approval that ALREADY qualifies also answers
  // approval_not_required: there is nothing left to request.
  it('refuses with 409 approval_not_required when the current approval already qualifies', async () => {
    seededCarts = [makeCartFixture({ approvalId: 'approval-1' })]
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub(10)
    const getApproval = jest.fn(async () => ({ id: 'approval-1', status: 'approved', amountGross: '50', currencyCode: 'USD' }))
    const requestApproval = jest.fn()
    const approvalService = makeApprovalServiceStub({ getApproval, requestApproval })
    const ctx = makeCtx({ em, customerGroupsService, customerPurchaseApprovalService: approvalService })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'approval_not_required' })
    expect(requestApproval).not.toHaveBeenCalled()
  })

  // §9a.4 step 3 — a stale pending approval (amount no longer covers) is withdrawn,
  // REQUESTER-initiated, before a fresh one is requested.
  it('withdraws a stale pending approval (amount no longer covers) before requesting a new one', async () => {
    seededCarts = [makeCartFixture({ approvalId: 'approval-1', customerId: 'customer-1' })]
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub(10)
    const getApproval = jest.fn(async () => ({ id: 'approval-1', status: 'pending', amountGross: '20', currencyCode: 'USD' }))
    const withdrawApproval = jest.fn(async () => ({}))
    const requestApproval = jest.fn(async () => ({
      approval: { id: 'approval-2', customerId: 'customer-1', amountGross: '50', currencyCode: 'USD', status: 'pending' },
      created: true,
    }))
    const approvalService = makeApprovalServiceStub({ getApproval, withdrawApproval, requestApproval })
    const ctx = makeCtx({ em, customerGroupsService, customerPurchaseApprovalService: approvalService })

    const result = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(withdrawApproval).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      approvalId: 'approval-1',
      actor: { actorType: 'customer_user', actorId: 'buyer-1', customerEntityId: 'customer-1' },
    })
    expect(requestApproval).toHaveBeenCalledTimes(1)
    expect(result.approvalId).toBe('approval-2')
    expect(seededCarts[0].approvalId).toBe('approval-2')
  })

  it('proceeds to request a new approval even when the stale pending withdrawal races to "already settled"', async () => {
    seededCarts = [makeCartFixture({ approvalId: 'approval-1' })]
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub(10)
    const getApproval = jest.fn(async () => ({ id: 'approval-1', status: 'pending', amountGross: '20', currencyCode: 'USD' }))
    const withdrawApproval = jest.fn(async () => {
      throw new CustomerPurchaseApprovalServiceError('approval_not_pending', '[internal] not pending')
    })
    const requestApproval = jest.fn(async () => ({
      approval: { id: 'approval-2', customerId: 'customer-1', amountGross: '50', currencyCode: 'USD', status: 'pending' },
      created: true,
    }))
    const approvalService = makeApprovalServiceStub({ getApproval, withdrawApproval, requestApproval })
    const ctx = makeCtx({ em, customerGroupsService, customerPurchaseApprovalService: approvalService })

    const result = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(result.approvalId).toBe('approval-2')
  })

  // Priority 4 — lock-state cases.
  it('refuses a locked cart with 423 cart_locked', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'session-1' })]
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'cart_locked' })
  })

  it.each(['merged', 'expired', 'converted'] as const)('refuses a %s cart with 409 cart_not_active', async (status) => {
    seededCarts = [makeCartFixture({ status })]
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'cart_not_active' })
  })

  it('reactivates an abandoned basket (any mutation reactivates, §9) before continuing', async () => {
    seededCarts = [makeCartFixture({ status: 'abandoned', resolvedAt: new Date('2026-02-20T00:00:00.000Z') })]
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub(10)
    const requestApproval = jest.fn(async () => ({
      approval: { id: 'approval-1', customerId: 'customer-1', amountGross: '50', currencyCode: 'USD', status: 'pending' },
      created: true,
    }))
    const approvalService = makeApprovalServiceStub({ requestApproval })
    const ctx = makeCtx({ em, customerGroupsService, customerPurchaseApprovalService: approvalService })

    await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(seededCarts[0].status).toBe('active')
    expect(seededCarts[0].resolvedAt).toBeNull()
  })

  it('refuses with 503 when the customer_groups approval service is unavailable', async () => {
    seededCarts = [makeCartFixture()]
    const em = makeEm()
    const ctx = makeCtx({ em, customerGroupsService: makeCustomerGroupsServiceStub(10) })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(503)
  })
})
