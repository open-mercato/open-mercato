// Release 5, Step 4.1 (checkout B.4 submit, steps 1-5 of C19/§7.2). This Step composes
// nearly every mechanism built in Phases 1-3 (cart lock, availability.reserve, credit
// reserve, the C9 guard) for the FIRST time — these tests exercise the COMPOSITION, not
// each piece in isolation (every piece already has its own unit tests from its own Step).

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn(), child: jest.fn() }
  logger.child.mockReturnValue(logger)
  return { createLogger: () => logger }
})

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

jest.mock('../../lib/sessionEvents', () => ({
  writeSessionEvent: jest.fn(async () => undefined),
}))

const mockLookupCartPeerById = jest.fn()
const mockLookupCartEnteredCodes = jest.fn(async () => [])
const mockLookupCartAppliedPromotionEffects = jest.fn(async () => [])
const mockLookupPromotionNames = jest.fn(async () => new Map())
jest.mock('../../lib/cartPeer', () => ({
  lookupCartPeerById: (...args: unknown[]) => mockLookupCartPeerById(...args),
  lookupCartEnteredCodes: (...args: unknown[]) => mockLookupCartEnteredCodes(...args),
  lookupCartAppliedPromotionEffects: (...args: unknown[]) => mockLookupCartAppliedPromotionEffects(...args),
  lookupPromotionNames: (...args: unknown[]) => mockLookupPromotionNames(...args),
}))

jest.mock('../../lib/deliveryAddress', () => ({
  resolveDestinationAddress: jest.fn(() => null),
  hashAddressForCache: jest.fn(() => 'address-hash'),
  hashCartLinesForCache: jest.fn(() => 'cart-hash'),
}))

const mockEvaluateDeliveryDiscount = jest.fn(async () => null)
jest.mock('../../lib/promotionsDeliveryEvaluation', () => ({
  evaluateDeliveryDiscount: (...args: unknown[]) => mockEvaluateDeliveryDiscount(...args),
}))

type FakeRow = Record<string, any>

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return row[key] === value
  })
}

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CheckoutSession } from '../../data/entities'
import type { CheckoutSessionSubmitCommandInput, CheckoutSessionSubmitStageResult } from '../submit'
import approvalApprovedSubscriber from '../../subscribers/approval-approved'

const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

const TENANT_ID = 'tenant-submit-1'
const ORG_ID = 'org-submit-1'
const SESSION_ID = 'session-submit-1'
const CART_ID = 'cart-submit-1'

function makeSession(overrides: FakeRow = {}): FakeRow {
  return {
    id: SESSION_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: CART_ID,
    storeId: null,
    linkId: null,
    channel: 'api',
    status: 'open',
    currencyCode: 'USD',
    locale: 'en-US',
    customerId: 'customer-1',
    customerUserId: null,
    shippingAddress: null,
    billingAddress: null,
    billingSameAsShipping: false,
    shippingMethod: { deliveryMethodCode: 'acme:standard', price: '5.00', currencyCode: 'USD' },
    quotedTotals: { deliveryMethodCode: 'acme:standard', deliveryCost: '5.00', deliveryDiscount: null, currencyCode: 'USD' },
    submitAttempt: 0,
    submitIdempotencyKey: null,
    stockReservationKey: null,
    creditReservationKey: null,
    submitProgress: null,
    submitStartedAt: null,
    salesQuoteId: null,
    salesOrderId: null,
    failureCode: null,
    failureDetail: null,
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeCartPeer(overrides: FakeRow = {}): FakeRow {
  return {
    id: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: null,
    channel: 'api',
    kind: 'basket',
    status: 'active',
    currencyCode: 'USD',
    locale: 'en-US',
    customerId: 'customer-1',
    customerUserId: null,
    customerIds: ['customer-1'],
    customerGroupIds: [],
    ...overrides,
  }
}

const SNAPSHOT_TOTALS = {
  subtotalNetAmount: 100,
  subtotalGrossAmount: 120,
  discountTotalAmount: 0,
  taxTotalAmount: 20,
  grandTotalNetAmount: 100,
  grandTotalGrossAmount: 120,
}

function makeSnapshot(overrides: FakeRow = {}) {
  return {
    lines: [
      { cartLineId: 'line-1', snapshot: { kind: 'product', productId: 'product-1', productVariantId: null, quantity: 2, currencyCode: 'USD', unitPriceNet: 50, unitPriceGross: 60 } },
    ],
    adjustments: [],
    totals: { ...SNAPSHOT_TOTALS },
    currencyCode: 'USD',
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeGoodsCalc(totals: FakeRow = SNAPSHOT_TOTALS) {
  return { kind: 'quote', currencyCode: 'USD', lines: [], adjustments: [], totals: { ...totals } }
}

type Harness = {
  ctx: CommandRuntimeContext
  seededSessions: FakeRow[]
  seededQuotes: FakeRow[]
  seededOrders: FakeRow[]
  commandBusExecute: jest.Mock
  cartService: { lock: jest.Mock; unlock: jest.Mock; getSalesSnapshot: jest.Mock; markConverted: jest.Mock }
  customerCreditService: { reserveCredit: jest.Mock; releaseCredit: jest.Mock; linkCreditReservationToOrder: jest.Mock } | null
  policyResolutionServiceAvailable: boolean
  salesCalculationService: { calculateDocumentTotals: jest.Mock }
  promotionsService: { useCode: jest.Mock; registerUsage: jest.Mock } | null
  customerGroupsService: { resolveTerms: jest.Mock } | null
}

function makeTerms(overrides: FakeRow = {}): FakeRow {
  return {
    allowPurchaseOnAccount: true,
    allowQuoteRequests: false,
    requiresPoNumber: false,
    minOrderValue: null,
    termsCurrencyCode: 'USD',
    approvalPolicy: 'buyer',
    priceKindId: null,
    paymentTermsDays: null,
    approvalRequiredAbove: null,
    sources: {},
    ...overrides,
  }
}

function buildHarness(opts: {
  session?: FakeRow
  cartPeer?: FakeRow
  snapshot?: FakeRow
  goodsCalcTotals?: FakeRow
  reserveResult?: FakeRow
  reserveCreditResult?: FakeRow
  customerCreditServiceAvailable?: boolean
  policyResolutionServiceAvailable?: boolean
  paymentGatewayServiceAvailable?: boolean
  promotionsServiceAvailable?: boolean
  useCodeError?: Error
  registerUsageResult?: FakeRow
  commitResult?: FakeRow
  createPaymentSessionResult?: FakeRow
  seededQuotes?: FakeRow[]
  seededOrders?: FakeRow[]
  seededOrderLines?: FakeRow[]
  seededQuoteLines?: FakeRow[]
  customerGroupsServiceAvailable?: boolean
  terms?: FakeRow
} = {}): Harness {
  const seededSessions = [opts.session ?? makeSession()]
  const seededQuotes = opts.seededQuotes ?? []
  const seededOrders = opts.seededOrders ?? []

  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === CheckoutSession) return seededSessions.find((row) => matchesWhere(row, where)) ?? null
    return null
  })
  mockLookupCartPeerById.mockImplementation(async () => opts.cartPeer ?? makeCartPeer())

  const snapshot = opts.snapshot ?? makeSnapshot()
  const cartService = {
    lock: jest.fn(async () => ({ cart: { status: 'locked' }, priceChanges: [], extended: false })),
    unlock: jest.fn(async () => ({ cart: { status: 'active' } })),
    getSalesSnapshot: jest.fn(async () => snapshot),
    markConverted: jest.fn(async () => ({ cart: { status: 'converted' } })),
  }

  const customerCreditService = opts.customerCreditServiceAvailable === false
    ? null
    : {
        reserveCredit: jest.fn(async () => (opts.reserveCreditResult ?? {
          reserved: true,
          released: false,
          entry: { entryId: 'entry-1', creditAccountId: 'account-1', entryType: 'reserve', amount: '125.00', balanceAfter: '125.00', idempotencyKey: 'key', relatedEntryId: null, linkedOrderId: null },
          check: { allowed: true, reason: 'ok', customerId: 'customer-1', creditAccountId: 'account-1', creditLimit: '1000.00', exposure: '125.00', available: '875.00', currencyCode: 'USD' },
        })),
        releaseCredit: jest.fn(async () => ({ released: true, entryId: 'entry-2' })),
        linkCreditReservationToOrder: jest.fn(async () => ({ linked: true, entryId: 'entry-1' })),
      }

  const salesCalculationService = {
    calculateDocumentTotals: jest.fn(async () => makeGoodsCalc(opts.goodsCalcTotals ?? SNAPSHOT_TOTALS)),
  }

  const seededOrderLines = opts.seededOrderLines ?? []
  const orderStatusEntries = [
    { id: 'status-confirmed', normalized_value: 'confirmed', tenant_id: TENANT_ID, organization_id: ORG_ID, key: 'sales.order_status', deleted_at: null },
    { id: 'status-canceled', normalized_value: 'canceled', tenant_id: TENANT_ID, organization_id: ORG_ID, key: 'sales.order_status', deleted_at: null },
  ]

  const commandBusExecute = jest.fn(async (id: string, options: { input: any }) => {
    if (id === 'availability.reserve') {
      return { result: opts.reserveResult ?? { reserved: true, reservationId: 'reservation-1', status: 'active', expiresAt: null, lines: [], shortfall: [] } }
    }
    if (id === 'availability.release') {
      return { result: { reservationId: 'reservation-1', status: 'released', released: true } }
    }
    if (id === 'availability.commit') {
      return { result: opts.commitResult ?? { reservationId: 'reservation-1', status: 'committed', shortfall: [] } }
    }
    if (id === 'sales.quotes.create') {
      const quoteId = `quote-${seededQuotes.length + 1}`
      seededQuotes.push({ id: quoteId, tenant_id: TENANT_ID, organization_id: ORG_ID, external_reference: options.input.externalReference, deleted_at: null })
      return { result: { quoteId } }
    }
    if (id === 'sales.quotes.convert_to_order') {
      const orderId = options.input.quoteId
      seededOrders.push({ id: orderId, tenant_id: TENANT_ID, organization_id: ORG_ID, deleted_at: null, grand_total_gross_amount: '125.00', currency_code: 'USD' })
      return { result: { orderId } }
    }
    if (id === 'sales.orders.update') {
      const order = seededOrders.find((row) => row.id === options.input.id)
      if (order) order.statusEntryId = options.input.statusEntryId
      return { result: { order } }
    }
    throw new Error(`Unexpected command id: ${id}`)
  })

  const paymentGatewayService = opts.paymentGatewayServiceAvailable === false
    ? null
    : {
        createPaymentSession: jest.fn(async () => (opts.createPaymentSessionResult ?? {
          transaction: { id: 'gateway-txn-1', unifiedStatus: 'captured', expiresAt: null },
          session: { sessionId: 'gateway-session-1', status: 'captured' },
        })),
      }

  const promotionsService = opts.promotionsServiceAvailable === false
    ? null
    : {
        useCode: jest.fn(async () => {
          if (opts.useCodeError) throw opts.useCodeError
          return { ok: true }
        }),
        registerUsage: jest.fn(async () => (opts.registerUsageResult ?? { ok: true, budgetExceeded: [] })),
      }

  const customerGroupsService = opts.customerGroupsServiceAvailable === false
    ? null
    : {
        resolveTerms: jest.fn(async () => (opts.terms ?? makeTerms())),
      }

  const seededQuoteLines = opts.seededQuoteLines ?? []

  const registrations: Record<string, unknown> = {
    em: null, // set below once `em` is built (needs `registrations` reference first)
    commandBus: { execute: commandBusExecute },
    cartService,
    salesCalculationService,
    ...(customerCreditService ? { customerCreditService } : {}),
    ...(opts.policyResolutionServiceAvailable === false ? {} : { policyResolutionService: {} }),
    ...(paymentGatewayService ? { paymentGatewayService } : {}),
    ...(promotionsService ? { promotionsService } : {}),
    ...(customerGroupsService ? { customerGroupsService } : {}),
  }

  function unqualify(col: string): string {
    const idx = col.lastIndexOf('.')
    return idx >= 0 ? col.slice(idx + 1) : col
  }

  const em: FakeRow = {
    fork: () => em,
    // Step 5.2's own resume subscriber reads `CheckoutSession` rows via `em.find` (never
    // `nativeUpdate`'s `findOne`) — additive so the REAL subscriber handler can run against
    // this SAME `seededSessions` array in the cross-module "resubmit re-hits cart.lock's
    // gate" test below, not a second, parallel fake.
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CheckoutSession) return seededSessions.filter((row) => matchesWhere(row, where))
      return []
    }),
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, set: FakeRow) => {
      if (entity === CheckoutSession) {
        const matched = seededSessions.filter((row) => matchesWhere(row, where))
        for (const row of matched) Object.assign(row, set)
        return matched.length
      }
      return 0
    }),
    create: jest.fn((_entity: unknown, data: FakeRow) => ({ id: 'checkout-txn-1', ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    findOne: jest.fn(async () => null),
    getKysely: () => ({
      selectFrom(table: string) {
        const filters: Array<{ col: string; op: string; value: unknown }> = []
        const builder = {
          select() { return builder },
          innerJoin() { return builder },
          where(col: string, op: string, value: unknown) {
            filters.push({ col: unqualify(col), op, value })
            return builder
          },
          matches(row: FakeRow): boolean {
            return filters.every(({ col, op, value }) => {
              if (op === 'in') return Array.isArray(value) && value.includes(row[col])
              if (op === 'is') return value === null ? row[col] == null : row[col] === value
              if (op === 'is not') return value === null ? row[col] != null : row[col] !== value
              return row[col] === value
            })
          },
          async executeTakeFirst() {
            const rows = table === 'sales_quotes' ? seededQuotes
              : table === 'sales_orders' ? seededOrders
              : table === 'dictionary_entries' ? orderStatusEntries
              : []
            return rows.find((row) => builder.matches(row))
          },
          async execute() {
            const rows = table === 'sales_order_lines' ? seededOrderLines
              : table === 'sales_quote_lines' ? seededQuoteLines
              : []
            return rows.filter((row) => builder.matches(row))
          },
        }
        return builder
      },
    }),
  }
  registrations.em = em

  const container = {
    resolve: (name: string) => {
      if (name in registrations) return registrations[name]
      throw new Error(`Unexpected DI token: ${name}`)
    },
    register: jest.fn(),
  }

  const ctx: CommandRuntimeContext = {
    container: container as any,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }

  return {
    ctx,
    seededSessions,
    seededQuotes,
    seededOrders,
    commandBusExecute,
    cartService,
    customerCreditService,
    policyResolutionServiceAvailable: opts.policyResolutionServiceAvailable !== false,
    salesCalculationService,
    promotionsService,
    customerGroupsService,
  }
}

function getHandler() {
  const handler = commandRegistry.get<CheckoutSessionSubmitCommandInput, CheckoutSessionSubmitStageResult>('checkout.session.submit')
  expect(handler).toBeTruthy()
  return handler!
}

const BASE_INPUT: CheckoutSessionSubmitCommandInput = {
  sessionId: SESSION_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  idempotencyKey: 'idem-1',
  paymentMethodCode: 'gateway:acme',
}

describe('checkout.session.submit (B.4, steps 1-5 of §7.2/C19)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../submit')
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('1. full happy path (gateway method): lock -> reserve -> non-confirmed quote -> converted order', async () => {
    const h = buildHarness()

    const result = await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.cartService.lock).toHaveBeenCalledWith(expect.objectContaining({ cartId: CART_ID, checkoutSessionId: SESSION_ID, purpose: 'order' }))
    expect(h.commandBusExecute).toHaveBeenCalledWith('availability.reserve', expect.objectContaining({
      input: expect.objectContaining({ sourceType: 'checkout', sourceId: SESSION_ID, idempotencyKey: 'checkout:session-submit-1:1:stock' }),
    }))
    expect(h.customerCreditService?.reserveCredit).not.toHaveBeenCalled()
    expect(h.commandBusExecute).toHaveBeenCalledWith('sales.quotes.create', expect.objectContaining({
      input: expect.objectContaining({ externalReference: 'checkout:session-submit-1:1' }),
    }))
    expect(h.commandBusExecute).toHaveBeenCalledWith('sales.quotes.convert_to_order', expect.objectContaining({ input: { quoteId: result.salesQuoteId } }))
    expect(result.salesOrderId).toBe(result.salesQuoteId)
    // Step 4.2 extends the SAME call through steps 6-8 — a gateway mock that returns a
    // synchronously-terminal status (the common test-gateway shape) reaches `completed`
    // within this one call, same as a real auto-capturing provider would.
    expect(h.commandBusExecute).toHaveBeenCalledWith('availability.commit', expect.objectContaining({
      input: expect.objectContaining({ idempotencyKey: 'checkout:session-submit-1:1:stock', orderId: result.salesOrderId }),
    }))
    expect(h.cartService.markConverted).toHaveBeenCalledWith(expect.objectContaining({ cartId: CART_ID, salesOrderId: result.salesOrderId }))
    expect(h.seededSessions[0]).toMatchObject({ status: 'completed', outcomeKind: 'order', salesQuoteId: result.salesQuoteId, salesOrderId: result.salesOrderId })
  })

  it('1b. full happy path (on_account method): reserves credit for the full payable amount (D-R5-24)', async () => {
    const h = buildHarness()

    const result = await getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'on_account' }, h.ctx)

    expect(h.customerCreditService?.reserveCredit).toHaveBeenCalledWith(expect.objectContaining({
      buyer: { customerIds: ['customer-1'] },
      currencyCode: 'USD',
      // goods gross 120 + delivery 5.00 - no discount = 125.00
      amount: '125.00',
      sourceType: 'checkout',
      idempotencyKey: 'checkout:session-submit-1:1:credit',
    }))
    expect(result.creditReservationKey).toBe('checkout:session-submit-1:1:credit')
  })

  it('1c. full happy path (on_account method): a gross total that is not a whole number of cents does not false-positive 409 totals_mismatch', async () => {
    // Round-3 QA repro (bug 13): gross-inclusive VAT pricing commonly leaves
    // `grand_total_gross_amount` with more than 2 decimals (here 119.9988, from a
    // `numeric(16,4)` column) — comparing the reservation's own rounded `125.00`-style
    // amount against this UNROUNDED total with a 0.0005 epsilon always failed. Delivery is
    // zeroed out here so the only source of sub-cent precision is the goods total itself.
    const nonRoundTotals = { ...SNAPSHOT_TOTALS, grandTotalGrossAmount: '119.9988' }
    const h = buildHarness({
      session: makeSession({
        shippingMethod: { deliveryMethodCode: 'acme:standard', price: '0.00', currencyCode: 'USD' },
        quotedTotals: { deliveryMethodCode: 'acme:standard', deliveryCost: '0.00', deliveryDiscount: null, currencyCode: 'USD' },
      }),
      snapshot: makeSnapshot({ totals: nonRoundTotals }),
      goodsCalcTotals: nonRoundTotals,
    })

    const result = await getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'on_account' }, h.ctx)

    expect(h.customerCreditService?.reserveCredit).toHaveBeenCalledWith(expect.objectContaining({
      amount: '120.00',
    }))
    expect(result.salesOrderId).toBeTruthy()
  })

  it('2. idempotent document creation: reuses an existing quote/order found by external_reference, never duplicating sales.quotes.create', async () => {
    const h = buildHarness({
      session: makeSession({ submitAttempt: 0 }),
      seededQuotes: [{ id: 'quote-existing', tenant_id: TENANT_ID, organization_id: ORG_ID, external_reference: 'checkout:session-submit-1:1', deleted_at: null }],
      seededOrders: [{ id: 'quote-existing', tenant_id: TENANT_ID, organization_id: ORG_ID, deleted_at: null }],
    })

    const result = await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.commandBusExecute).not.toHaveBeenCalledWith('sales.quotes.create', expect.anything())
    expect(h.commandBusExecute).not.toHaveBeenCalledWith('sales.quotes.convert_to_order', expect.anything())
    expect(result.salesQuoteId).toBe('quote-existing')
    expect(result.salesOrderId).toBe('quote-existing')
  })

  it('2b. idempotent document creation: reuses an existing quote but still converts when no order exists yet for it', async () => {
    const h = buildHarness({
      seededQuotes: [{ id: 'quote-existing', tenant_id: TENANT_ID, organization_id: ORG_ID, external_reference: 'checkout:session-submit-1:1', deleted_at: null }],
      seededOrders: [],
    })

    const result = await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.commandBusExecute).not.toHaveBeenCalledWith('sales.quotes.create', expect.anything())
    expect(h.commandBusExecute).toHaveBeenCalledWith('sales.quotes.convert_to_order', expect.objectContaining({ input: { quoteId: 'quote-existing' } }))
    expect(result.salesQuoteId).toBe('quote-existing')
  })

  it('3. priceChanges from cart.lock aborts 409 price_changed and compensates (unlock, session back to open)', async () => {
    const h = buildHarness()
    h.cartService.lock.mockResolvedValue({ cart: { status: 'locked' }, priceChanges: [{ lineId: 'line-1', reason: 'repriced' }], extended: false })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'price_changed' }) })

    expect(h.cartService.unlock).toHaveBeenCalledWith(expect.objectContaining({ cartId: CART_ID, checkoutSessionId: SESSION_ID }))
    expect(h.seededSessions[0].status).toBe('open')
    expect(h.commandBusExecute).not.toHaveBeenCalledWith('availability.reserve', expect.anything())
  })

  it('4. a shortfall line aborts 409 stock_shortfall, releases availability and unlocks the cart, nothing else written', async () => {
    const h = buildHarness({ reserveResult: { reserved: false, reservationId: null, status: null, expiresAt: null, lines: [], shortfall: [{ catalogProductId: 'product-1', catalogVariantId: null, requested: 2, available: 0 }] } })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'stock_shortfall' }) })

    expect(h.commandBusExecute).toHaveBeenCalledWith('availability.release', expect.objectContaining({ input: expect.objectContaining({ idempotencyKey: 'checkout:session-submit-1:1:stock' }) }))
    expect(h.cartService.unlock).toHaveBeenCalled()
    expect(h.seededSessions[0].status).toBe('open')
    expect(h.commandBusExecute).not.toHaveBeenCalledWith('sales.quotes.create', expect.anything())
  })

  it('5. a credit refusal aborts 402 credit_refused AND releases the just-made availability reservation (compensation)', async () => {
    const h = buildHarness({ reserveCreditResult: { reserved: false, released: false, entry: null, check: { allowed: false, reason: 'limit_exceeded', customerId: 'customer-1', creditAccountId: 'account-1', creditLimit: '100.00', exposure: '100.00', available: '0.00', currencyCode: 'USD' } } })

    await expect(getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'on_account' }, h.ctx)).rejects.toMatchObject({
      status: 402,
      body: expect.objectContaining({ code: 'credit_refused', reason: 'limit_exceeded' }),
    })

    expect(h.commandBusExecute).toHaveBeenCalledWith('availability.release', expect.anything())
    expect(h.cartService.unlock).toHaveBeenCalled()
    expect(h.seededSessions[0].status).toBe('open')
    // Credit was never actually reserved (refused), so releaseCredit must not be called.
    expect(h.customerCreditService?.releaseCredit).not.toHaveBeenCalled()
  })

  it('6. C7 totals mismatch aborts 500 totals_mismatch AND compensates (releases availability + credit)', async () => {
    const h = buildHarness({ goodsCalcTotals: { ...SNAPSHOT_TOTALS, subtotalGrossAmount: 999 } })

    await expect(getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'on_account' }, h.ctx)).rejects.toMatchObject({
      status: 500,
      body: expect.objectContaining({ code: 'totals_mismatch' }),
    })

    expect(h.customerCreditService?.releaseCredit).toHaveBeenCalledWith(expect.objectContaining({ reserveIdempotencyKey: 'checkout:session-submit-1:1:credit' }))
    expect(h.commandBusExecute).toHaveBeenCalledWith('availability.release', expect.anything())
    expect(h.cartService.unlock).toHaveBeenCalled()
    expect(h.seededSessions[0].status).toBe('open')
    // The quote itself is NOT deleted — left as an ordinary, visible unconverted quote.
    expect(h.seededQuotes).toHaveLength(1)
    expect(h.commandBusExecute).not.toHaveBeenCalledWith('sales.quotes.convert_to_order', expect.anything())
  })

  it('7. the C9 guard re-fires at submit — a cart that drifted since session creation (different currency) is refused', async () => {
    const h = buildHarness({ cartPeer: makeCartPeer({ currencyCode: 'EUR' }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'cart_store_mismatch' }) })

    // Refused BEFORE the CAS even runs — nothing taken, session stays exactly as it was.
    expect(h.seededSessions[0].status).toBe('open')
    expect(h.cartService.lock).not.toHaveBeenCalled()
  })

  it('8. a non-on-account submit skips credit reservation entirely with no side effect', async () => {
    const h = buildHarness()

    await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.customerCreditService?.reserveCredit).not.toHaveBeenCalled()
    expect(h.customerCreditService?.releaseCredit).not.toHaveBeenCalled()
  })

  it('answers 409 submit_in_progress when the session is already submitting', async () => {
    const h = buildHarness({ session: makeSession({ status: 'submitting' }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'submit_in_progress' }) })
    expect(h.cartService.lock).not.toHaveBeenCalled()
  })

  it('answers 404 when the session does not exist', async () => {
    const h = buildHarness()
    mockFindOneWithDecryption.mockResolvedValue(null)

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 404 })
  })

  it('answers 422 steps_incomplete when no delivery method has been selected yet', async () => {
    const h = buildHarness({ session: makeSession({ shippingMethod: null }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'steps_incomplete' }) })
  })

  it('refuses request_quote with 422 payment_method_unavailable when allowQuoteRequests resolves false (entitlement never trusted from the client, §5.5)', async () => {
    const h = buildHarness({ terms: makeTerms({ allowQuoteRequests: false }) })

    await expect(getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'request_quote' }, h.ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'payment_method_unavailable' }),
    })
    expect(h.cartService.lock).not.toHaveBeenCalled()
  })

  it('refuses request_quote the same way when customer_groups is absent (fail-closed)', async () => {
    const h = buildHarness({ customerGroupsServiceAvailable: false })

    await expect(getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'request_quote' }, h.ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'payment_method_unavailable' }),
    })
  })

  it('answers 409 cart_empty when the locked cart snapshot has no lines', async () => {
    const h = buildHarness({ snapshot: makeSnapshot({ lines: [] }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'cart_empty' }) })
    expect(h.cartService.unlock).toHaveBeenCalled()
    expect(h.seededSessions[0].status).toBe('open')
  })

  it('skips availability.reserve entirely when availability is absent (D-R5-18: lines are not_tracked)', async () => {
    const h = buildHarness({ policyResolutionServiceAvailable: false })

    const result = await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.commandBusExecute).not.toHaveBeenCalledWith('availability.reserve', expect.anything())
    expect(result.stockReservationKey).toBeNull()
  })

  it('refuses on_account with 402 credit_refused when customer_groups is absent (fail-closed)', async () => {
    const h = buildHarness({ customerCreditServiceAvailable: false })

    await expect(getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'on_account' }, h.ctx)).rejects.toMatchObject({
      status: 402,
      body: expect.objectContaining({ code: 'credit_refused' }),
    })
  })
})

describe('checkout.session.submit (B.4, steps 6-8 of §7.2/C19 — Step 4.2)', () => {
  // `commandRegistry` is a module-level singleton already populated by the sibling
  // describe block's own `beforeAll` above (same file, same Node module cache) — clearing
  // and re-importing here would just wipe it with nothing left to repopulate it, since
  // `import('../submit')` is memoized and its top-level `registerCommand(...)` never runs
  // twice.

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('on-account: links the credit reservation to the order (C6) and completes with no gateway call', async () => {
    const h = buildHarness()

    const result = await getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'on_account' }, h.ctx)

    expect(h.customerCreditService?.linkCreditReservationToOrder).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      idempotencyKey: 'checkout:session-submit-1:1:credit',
      orderId: result.salesOrderId,
    })
    expect(h.seededSessions[0]).toMatchObject({ status: 'completed', outcomeKind: 'order' })
  })

  it('availability.commit (step 6a) is called BEFORE the gateway call (step 7) — ordering assertion', async () => {
    const h = buildHarness()
    const callOrder: string[] = []
    const originalExecute = h.commandBusExecute.getMockImplementation()!
    h.commandBusExecute.mockImplementation(async (id: string, options: unknown) => {
      callOrder.push(id)
      return originalExecute(id, options as { input: any })
    })
    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock }
    const originalCreatePaymentSession = paymentGatewayService.createPaymentSession.getMockImplementation()!
    paymentGatewayService.createPaymentSession.mockImplementation(async (...args: unknown[]) => {
      callOrder.push('paymentGatewayService.createPaymentSession')
      return originalCreatePaymentSession(...args)
    })

    await getHandler().execute(BASE_INPUT, h.ctx)

    const commitIndex = callOrder.indexOf('availability.commit')
    const gatewayCallIndex = callOrder.indexOf('paymentGatewayService.createPaymentSession')
    expect(commitIndex).toBeGreaterThanOrEqual(0)
    expect(gatewayCallIndex).toBeGreaterThan(commitIndex)
    expect(h.cartService.lock).toHaveBeenCalledTimes(2) // fresh lock (step 1) + payment-window extend (step 7, C1)
  })

  it('a refused promotion code (C5) compensates by CANCELLING the order (not a hand-rolled release) and aborts 409 promotion_unavailable', async () => {
    const h = buildHarness({ promotionsServiceAvailable: true })
    // `lookupCartEnteredCodes` is called both at §7.2 step 2 (delivery re-evaluation) and
    // again inside step 6c — two chained `Once` resolutions (never a bare
    // `mockResolvedValue`, which would leak this code into every later test sharing this
    // module-level mock).
    const enteredCode = [{ id: 'code-1', type: 'static', codeString: 'SAVE10' }]
    mockLookupCartEnteredCodes.mockResolvedValueOnce(enteredCode).mockResolvedValueOnce(enteredCode)
    h.promotionsService!.useCode.mockRejectedValue(new Error('code already used'))

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'promotion_unavailable' }),
    })

    // Compensation is "cancel the order" (statusEntryId -> canceled), never a hand-rolled
    // parallel release of stock/credit — those release through the order's own
    // `sales.order.cancelled` subscribers.
    expect(h.commandBusExecute).toHaveBeenCalledWith('sales.orders.update', expect.objectContaining({
      input: expect.objectContaining({ statusEntryId: 'status-canceled' }),
    }))
    expect(h.cartService.unlock).toHaveBeenCalled()
    expect(h.seededSessions[0].status).toBe('failed')
    expect(h.seededSessions[0].failureCode).toBe('promotion_unavailable')
  })

  it('a non-empty budgetExceeded (C5) compensates by cancelling the order and aborts 409 promotion_unavailable', async () => {
    const h = buildHarness({ promotionsServiceAvailable: true, registerUsageResult: { ok: true, budgetExceeded: ['promotion-1'] } })
    mockLookupCartAppliedPromotionEffects.mockResolvedValueOnce([{ promotionId: 'promotion-1', effects: [{ type: 'CART_DISCOUNT', amountNet: '-10.00', amountGross: '-10.00' }] }])

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'promotion_unavailable' }),
    })

    expect(h.commandBusExecute).toHaveBeenCalledWith('sales.orders.update', expect.objectContaining({
      input: expect.objectContaining({ statusEntryId: 'status-canceled' }),
    }))
    expect(h.seededSessions[0].status).toBe('failed')
  })

  it('a gateway failure compensates by CANCELLING the order and the session ends failed', async () => {
    const h = buildHarness({ createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'failed', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'failed' } } })

    // Must be `payment_failed`, never `credit_refused` — that code is reserved for the
    // DISTINCT on-account credit-reservation refusal at step 4 (G1/G2), a different
    // failure mode an API consumer needs to tell apart from a declined gateway payment.
    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 402,
      body: expect.objectContaining({ code: 'payment_failed' }),
    })

    expect(h.commandBusExecute).toHaveBeenCalledWith('sales.orders.update', expect.objectContaining({
      input: expect.objectContaining({ statusEntryId: 'status-canceled' }),
    }))
    expect(h.cartService.unlock).toHaveBeenCalled()
    expect(h.seededSessions[0].status).toBe('failed')
    expect(h.cartService.markConverted).not.toHaveBeenCalled()
  })

  it('a gateway intent-creation failure compensates by cancelling the order (502 payment_unavailable)', async () => {
    const h = buildHarness({ paymentGatewayServiceAvailable: true })
    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock }
    paymentGatewayService.createPaymentSession.mockRejectedValueOnce(new Error('gateway unreachable'))

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 502,
      body: expect.objectContaining({ code: 'payment_unavailable' }),
    })

    expect(h.seededSessions[0].status).toBe('failed')
  })

  it('builds the correct lineMap from the order lines (C18) and passes it to cart.markConverted', async () => {
    const h = buildHarness({
      seededOrderLines: [
        { id: 'order-line-1', order_id: 'quote-1', tenant_id: TENANT_ID, organization_id: ORG_ID, metadata: { cartLineId: 'line-1' }, deleted_at: null },
      ],
    })

    const result = await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.cartService.markConverted).toHaveBeenCalledWith(expect.objectContaining({
      salesOrderId: result.salesOrderId,
      lineMap: [{ cartLineId: 'line-1', salesOrderLineId: 'order-line-1' }],
    }))
  })

  it('stays at awaiting_payment when the gateway reports a still-pending status (async completion is a separate, later event)', async () => {
    const h = buildHarness({ createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'pending', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'pending' } } })

    const result = await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.seededSessions[0]).toMatchObject({ status: 'awaiting_payment', submitProgress: 'payment_initiated' })
    expect(h.cartService.markConverted).not.toHaveBeenCalled()
    expect(result.salesOrderId).toBeTruthy()
  })
})

describe('checkout.session.submit (B.5, §8/C15-C17, D-R5-20/23/26/28 — Step 5.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('the quote branch (request_quote, terms allow it): locks with purpose "quote", releases stock (never commits), reserves no credit, converts no order, markConverted with the quote lineMap, completes with outcomeKind "quote"', async () => {
    const h = buildHarness({
      terms: makeTerms({ allowQuoteRequests: true }),
      seededQuoteLines: [
        { id: 'quote-line-1', quote_id: 'quote-1', tenant_id: TENANT_ID, organization_id: ORG_ID, metadata: { cartLineId: 'line-1' }, deleted_at: null },
      ],
    })

    const result = await getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'request_quote' }, h.ctx)

    expect(h.cartService.lock).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'quote' }))
    expect(h.commandBusExecute).toHaveBeenCalledWith('availability.release', expect.objectContaining({
      input: expect.objectContaining({ idempotencyKey: 'checkout:session-submit-1:1:stock', reason: 'quote' }),
    }))
    expect(h.commandBusExecute).not.toHaveBeenCalledWith('availability.commit', expect.anything())
    expect(h.customerCreditService?.reserveCredit).not.toHaveBeenCalled()
    expect(h.commandBusExecute).not.toHaveBeenCalledWith('sales.quotes.convert_to_order', expect.anything())
    expect(h.cartService.markConverted).toHaveBeenCalledWith(expect.objectContaining({
      salesQuoteId: result.salesQuoteId,
      lineMap: [{ cartLineId: 'line-1', salesQuoteLineId: 'quote-line-1' }],
    }))
    expect(h.seededSessions[0]).toMatchObject({ status: 'completed', outcomeKind: 'quote', salesQuoteId: result.salesQuoteId })
    expect(result.salesOrderId).toBeNull()
  })

  it('the quote branch snapshots cart.lock\'s own approval-gate verdict onto the quote so sales/api/quotes/accept can re-run it (D-R5-23)', async () => {
    const h = buildHarness({ terms: makeTerms({ allowQuoteRequests: true }) })
    h.cartService.lock.mockResolvedValue({
      cart: { status: 'locked', requiresApproval: true, approvalId: 'approval-xyz' },
      priceChanges: [],
      extended: false,
    })

    await getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'request_quote' }, h.ctx)

    expect(h.commandBusExecute).toHaveBeenCalledWith('sales.quotes.create', expect.objectContaining({
      input: expect.objectContaining({
        metadata: expect.objectContaining({ pendingApproval: { required: true, approvalId: 'approval-xyz' } }),
      }),
    }))
  })

  it('the quote branch never calls the payment gateway', async () => {
    const h = buildHarness({ terms: makeTerms({ allowQuoteRequests: true }) })

    await getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'request_quote' }, h.ctx)

    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock }
    expect(paymentGatewayService.createPaymentSession).not.toHaveBeenCalled()
  })

  it('min_order_value refuses a too-small cart (goods gross below the threshold, same currency)', async () => {
    const h = buildHarness({ terms: makeTerms({ minOrderValue: 500, termsCurrencyCode: 'USD' }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'below_min_order_value', minOrderValue: 500, currencyCode: 'USD' }),
    })
    expect(h.cartService.unlock).toHaveBeenCalled()
    expect(h.seededSessions[0].status).toBe('open')
    expect(h.commandBusExecute).not.toHaveBeenCalledWith('availability.reserve', expect.anything())
  })

  it('min_order_value lets a cart at or above the threshold proceed', async () => {
    const h = buildHarness({ terms: makeTerms({ minOrderValue: 120, termsCurrencyCode: 'USD' }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).resolves.toMatchObject({ salesOrderId: expect.any(String) })
  })

  it('min_order_value is NOT checked when the cart currency differs from terms_currency_code (fail-open, D-R5-4/§8.5)', async () => {
    const h = buildHarness({ terms: makeTerms({ minOrderValue: 999999, termsCurrencyCode: 'EUR' }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).resolves.toMatchObject({ salesOrderId: expect.any(String) })
  })

  it('min_order_value is SKIPPED for a request_quote submit (D-R5-23), even far below the threshold', async () => {
    const h = buildHarness({ terms: makeTerms({ allowQuoteRequests: true, minOrderValue: 999999, termsCurrencyCode: 'USD' }) })

    await expect(getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'request_quote' }, h.ctx)).resolves.toMatchObject({ salesQuoteId: expect.any(String) })
  })

  it('requires a PO number with 422 purchase_order_number_required when the resolved term demands one and none was supplied', async () => {
    const h = buildHarness({ terms: makeTerms({ requiresPoNumber: true }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'purchase_order_number_required' }),
    })
    expect(h.cartService.lock).not.toHaveBeenCalled()
  })

  it('accepts a supplied PO number and writes it to customerReference at document creation', async () => {
    const h = buildHarness({ terms: makeTerms({ requiresPoNumber: true }) })

    await getHandler().execute({ ...BASE_INPUT, poNumber: 'PO-12345' }, h.ctx)

    expect(h.commandBusExecute).toHaveBeenCalledWith('sales.quotes.create', expect.objectContaining({
      input: expect.objectContaining({ customerReference: 'PO-12345' }),
    }))
  })

  it('leaves the PO number absent/optional when the resolved term does not require one', async () => {
    const h = buildHarness({ terms: makeTerms({ requiresPoNumber: false }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).resolves.toMatchObject({ salesOrderId: expect.any(String) })
    expect(h.commandBusExecute).toHaveBeenCalledWith('sales.quotes.create', expect.objectContaining({
      input: expect.objectContaining({ customerReference: undefined }),
    }))
  })

  it('a PO number is required for the quote outcome too (D-R5-28 applies regardless of purpose)', async () => {
    const h = buildHarness({ terms: makeTerms({ allowQuoteRequests: true, requiresPoNumber: true }) })

    await expect(getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'request_quote' }, h.ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'purchase_order_number_required' }),
    })
  })
})

// Release 5, Step 5.2 (C11, §8.2 steps 1/3/5) — glue test proving the approval-resume
// path end to end across TWO real pieces (submit's own `open`-only precondition AND the
// REAL `approval-approved` resume subscriber), not the subscriber in isolation: a session
// parked in `awaiting_approval` cannot reach `cart.lock` at all; the subscriber is the
// ONLY thing that reopens that door; and once reopened, the re-check of the approved
// amount is `cart.lock`'s own gate (K2, Step 3.1, tested in `cart`'s own suite) — this
// Step only has to prove checkout surfaces that gate's verdict unchanged on a resubmit.
describe('approval resume -> resubmit (Step 5.2, C11/§8.2)', () => {
  // `checkout.session.submit` is already registered by the SUITE ABOVE's own `beforeAll`
  // (module imports are cached — a second `commandRegistry.clear?.()` here would empty the
  // registry without a fresh import ever re-running `registerCommand`, since `'../submit'`
  // is already in Node's module cache). No clear-and-reimport needed in this file twice.
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('refuses a resubmit while the session is still awaiting_approval (409 session_not_open — the gate is shut)', async () => {
    const h = buildHarness({ session: makeSession({ status: 'awaiting_approval' }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'session_not_open' }),
    })
    expect(h.cartService.lock).not.toHaveBeenCalled()
  })

  it('the REAL approval-approved subscriber reopens the session, and a resubmit reaches cart.lock again', async () => {
    const h = buildHarness({ session: makeSession({ status: 'awaiting_approval' }) })
    expect(h.seededSessions[0].status).toBe('awaiting_approval')

    await approvalApprovedSubscriber(
      { subjectType: 'cart', subjectId: CART_ID, approvalId: 'approval-1', tenantId: TENANT_ID, organizationId: ORG_ID },
      { resolve: (name: string) => (name === 'em' ? h.ctx.container.resolve('em') : undefined) },
    )
    expect(h.seededSessions[0].status).toBe('open')

    await getHandler().execute(BASE_INPUT, h.ctx)
    expect(h.cartService.lock).toHaveBeenCalledWith(expect.objectContaining({ cartId: CART_ID, checkoutSessionId: SESSION_ID, purpose: 'order' }))
  })

  it('re-approval on a price rise: cart.lock re-refuses with 409 cart_requires_approval, surfaced unchanged', async () => {
    const h = buildHarness({ session: makeSession({ status: 'awaiting_approval' }) })

    await approvalApprovedSubscriber(
      { subjectType: 'cart', subjectId: CART_ID, approvalId: 'approval-1', tenantId: TENANT_ID, organizationId: ORG_ID },
      { resolve: (name: string) => (name === 'em' ? h.ctx.container.resolve('em') : undefined) },
    )
    expect(h.seededSessions[0].status).toBe('open')

    // The cart re-priced above the just-approved amount since the resume — `cart.lock`
    // (K2, Step 3.1) is the ONLY place this re-check happens; this mock stands in for that
    // already-tested gate so this Step can assert checkout's own propagation, not re-derive
    // cart's threshold logic.
    h.cartService.lock.mockRejectedValueOnce(
      Object.assign(new Error('[internal] cart_requires_approval'), {
        status: 409,
        body: { error: '[internal] cart_requires_approval', code: 'cart_requires_approval' },
      }),
    )

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'cart_requires_approval' }),
    })
    expect(h.cartService.lock).toHaveBeenCalledWith(expect.objectContaining({ cartId: CART_ID, checkoutSessionId: SESSION_ID, purpose: 'order' }))
    // Nothing was reserved yet at this failure point (`cart.lock` is step 1, before
    // availability/credit reservation) — `compensate`'s no-op release flags leave
    // `failures` empty, so the session reverts to `open` immediately, same as any other
    // lock-time refusal that attempts no release (price_changed, delivery changes).
    expect(h.seededSessions[0].status).toBe('open')
  })
})
