// Release 5, Step 4.1 (checkout B.4 submit, steps 1-5 of C19/§7.2). This Step composes
// nearly every mechanism built in Phases 1-3 (cart lock, availability.reserve, credit
// reserve, the C9 guard) for the FIRST time — these tests exercise the COMPOSITION, not
// each piece in isolation (every piece already has its own unit tests from its own Step).

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn(), child: jest.fn() }
  logger.child.mockReturnValue(logger)
  return { createLogger: () => logger }
})

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

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
    if (value && typeof value === 'object' && '$in' in value) return (value as { $in: unknown[] }).$in.includes(row[key])
    return row[key] === value
  })
}

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { CheckoutSession, CheckoutTransaction } from '../../data/entities'
import type { CheckoutSessionSubmitCommandInput, CheckoutSessionSubmitStageResult } from '../submit'
import approvalApprovedSubscriber from '../../subscribers/approval-approved'

const mockFindOneWithDecryption = jest.fn()
// `lib/approvalResumeSubscriber.ts`'s real handler (exercised below via the REAL
// `approval-approved` subscriber) now reads `CheckoutSession` rows through
// `findWithDecryption` instead of a raw `em.find` — delegate to whatever fake `em.find`
// the caller passed, matching this harness's own `em` mock below.
const mockFindWithDecryption = jest.fn(async (em: FakeRow, entity: unknown, where: Record<string, unknown>) => em.find(entity, where))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [FakeRow, unknown, Record<string, unknown>])),
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
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    termsAcceptedAt: new Date('2026-02-01T00:00:00.000Z'),
    email: 'buyer@example.com',
    shippingAddress: { line1: '1 Main St', city: 'Anytown', postalCode: '00000', countryCode: 'US' },
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
  seededTransactions: FakeRow[]
  seededPayments: FakeRow[]
  commandBusExecute: jest.Mock
  emExecute: jest.Mock
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
  getPaymentStatusResult?: FakeRow
  seededQuotes?: FakeRow[]
  seededOrders?: FakeRow[]
  seededOrderLines?: FakeRow[]
  seededQuoteLines?: FakeRow[]
  customerGroupsServiceAvailable?: boolean
  cartServiceAvailable?: boolean
  paymentsCreateError?: Error
  cancelPaymentError?: Error
  terms?: FakeRow
} = {}): Harness {
  const seededSessions = [opts.session ?? makeSession()]
  const seededQuotes = opts.seededQuotes ?? []
  const seededOrders = opts.seededOrders ?? []
  const seededTransactions: FakeRow[] = []
  const seededPayments: FakeRow[] = []

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
        // Finding 1: submit now re-resolves `listCheckoutPaymentMethods` (which calls
        // `checkCredit` to decide whether `on_account` is offered) BEFORE its own
        // `isOnAccount` branch below ever reserves credit.
        checkCredit: jest.fn(async () => ({ allowed: true, reason: 'ok' })),
      }

  // Finding 1: `listCheckoutPaymentMethods` is the canonical allow-list submit now
  // re-resolves `paymentMethodCode` against — register a descriptor matching
  // `BASE_INPUT.paymentMethodCode` ('gateway:acme') so the existing gateway-path tests
  // keep exercising the SAME method they always did.
  const paymentGatewayDescriptorService = {
    listResolved: jest.fn(async () => [
      { providerKey: 'gateway:acme', label: 'Acme', isConfigured: true, sessionConfig: { supportedCurrencies: '*' } },
    ]),
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
    if (id === 'sales.payments.create') {
      if (opts.paymentsCreateError) throw opts.paymentsCreateError
      seededPayments.push({ ...options.input, id: `payment-${seededPayments.length + 1}`, order_id: options.input.orderId, payment_reference: options.input.paymentReference ?? null, tenant_id: options.input.tenantId, organization_id: options.input.organizationId, captured_amount: options.input.capturedAmount ?? '0', deleted_at: null })
      return { result: { paymentId: `payment-${seededPayments.length}` } }
    }
    if (id === 'sales.payments.update') {
      const payment = seededPayments.find((row) => row.id === options.input.id)
      if (payment) {
        if (options.input.capturedAmount !== undefined) {
          payment.capturedAmount = options.input.capturedAmount
          payment.captured_amount = options.input.capturedAmount
        }
        if (options.input.capturedAt !== undefined) payment.capturedAt = options.input.capturedAt
        if (options.input.statusEntryId !== undefined) payment.statusEntryId = options.input.statusEntryId
      }
      return { result: { paymentId: options.input.id } }
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
        cancelPayment: opts.cancelPaymentError
          ? jest.fn(async () => { throw opts.cancelPaymentError })
          : jest.fn(async () => ({ status: 'cancelled' })),
        // #8268 review Major 5 (re-review): defaults to the SAME status the
        // `createPaymentSession` snapshot above carries, so every existing test keeps
        // observing identical behavior to before this mock existed; `getPaymentStatusResult`
        // lets a test simulate the provider's authoritative state having moved on from
        // that stale snapshot (e.g. a capture that lands in the lost-CAS race window).
        getPaymentStatus: jest.fn(async () => (
          opts.getPaymentStatusResult ?? { status: (opts.createPaymentSessionResult ?? { transaction: { unifiedStatus: 'captured' } }).transaction.unifiedStatus }
        )),
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
    ...(opts.cartServiceAvailable === false ? {} : { cartService }),
    salesCalculationService,
    ...(customerCreditService ? { customerCreditService } : {}),
    ...(opts.policyResolutionServiceAvailable === false ? {} : { policyResolutionService: {} }),
    ...(paymentGatewayService ? { paymentGatewayService } : {}),
    ...(promotionsService ? { promotionsService } : {}),
    ...(customerGroupsService ? { customerGroupsService } : {}),
    paymentGatewayDescriptorService,
  }

  function unqualify(col: string): string {
    const idx = col.lastIndexOf('.')
    return idx >= 0 ? col.slice(idx + 1) : col
  }

  const emExecute = jest.fn(async (_sql: string, _params?: unknown[]) => [{ active_reservation_count: 1 }])
  const em: FakeRow = {
    fork: () => em,
    execute: emExecute,
    // #8268 review Major 2 (re-review): `resumeOrderCancellationCompensation` now bundles
    // the slot release with the `submitProgress` CAS in one `em.transactional` block. A
    // real Postgres transaction rolls back EVERY write the callback made the instant any
    // of them throws — this fake has no competing writers to isolate, but it still needs
    // that same all-or-nothing guarantee, so a throw restores `seededSessions` to its
    // pre-callback snapshot instead of leaving a partially-applied `nativeUpdate` behind.
    transactional: jest.fn(async (cb: (tx: FakeRow) => Promise<unknown>) => {
      const snapshot = seededSessions.map((row) => ({ ...row }))
      try {
        return await cb(em)
      } catch (err) {
        seededSessions.splice(0, seededSessions.length, ...snapshot)
        throw err
      }
    }),
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
      if (entity === CheckoutTransaction) {
        const matched = seededTransactions.filter((row) => matchesWhere(row, where))
        for (const row of matched) Object.assign(row, set)
        return matched.length
      }
      return 0
    }),
    create: jest.fn((entity: unknown, data: FakeRow) => {
      if (entity === CheckoutTransaction) {
        const row = { id: 'checkout-txn-1', ...data }
        seededTransactions.push(row)
        return row
      }
      return { id: 'checkout-txn-1', ...data }
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CheckoutTransaction) return seededTransactions.find((row) => matchesWhere(row, where)) ?? null
      return null
    }),
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
              : table === 'sales_payments' ? seededPayments
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
    seededTransactions,
    seededPayments,
    commandBusExecute,
    emExecute,
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

  it('refuses on_account with 422 payment_method_unavailable when customer_groups is absent (fail-closed) — Finding 1', async () => {
    const h = buildHarness({ customerCreditServiceAvailable: false })

    // Finding 1: `listCheckoutPaymentMethods` (re-resolved at submit, before any
    // reservation) never offers `on_account` without a `customerCreditService` to run
    // `checkCredit` through — so this is now caught by the allow-list check, a 422
    // `payment_method_unavailable`, before the old `isOnAccount` branch's own (now
    // unreachable for this exact case) 402 `credit_refused` check.
    await expect(getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'on_account' }, h.ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'payment_method_unavailable' }),
    })
  })

  // §7.1 preconditions (C19/C14): none of these four guards had a test asserting they
  // actually reject an invalid submit — each runs BEFORE the CAS (step 0), so a rejection
  // here must take nothing: no reservation, no cart lock, no compensation.
  it('answers 409 session_expired and moves the session to expired when expiresAt has passed', async () => {
    const h = buildHarness({ session: makeSession({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'session_expired' }),
    })
    expect(h.seededSessions[0].status).toBe('expired')
    expect(h.cartService.lock).not.toHaveBeenCalled()
    expect(h.commandBusExecute).not.toHaveBeenCalled()
  })

  it('answers 422 steps_incomplete when terms have not been accepted', async () => {
    const h = buildHarness({ session: makeSession({ termsAcceptedAt: null }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'steps_incomplete', error: '[internal] terms must be accepted before submit' }),
    })
    expect(h.cartService.lock).not.toHaveBeenCalled()
  })

  it('answers 422 steps_incomplete when no email address is on the session', async () => {
    const h = buildHarness({ session: makeSession({ email: null }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'steps_incomplete', error: '[internal] an email address is required before submit' }),
    })
    expect(h.cartService.lock).not.toHaveBeenCalled()
  })

  it('answers 422 steps_incomplete when no shipping address is on the session', async () => {
    const h = buildHarness({ session: makeSession({ shippingAddress: null }) })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'steps_incomplete', error: '[internal] a shipping address is required before submit' }),
    })
    expect(h.cartService.lock).not.toHaveBeenCalled()
  })
})

describe('checkout.session.submit — submit_idempotency_key replay (§7.4/C19)', () => {
  // PR 8268 review fix: no existing test asserted this fires — a retry that lost its HTTP
  // response under the SAME idempotency key must replay the ORIGINAL attempt's result,
  // never re-create the quote/order and never a confusing 409.
  it('a retry under the SAME idempotency key after the session already completed replays the original result, never duplicating sales.quotes.create', async () => {
    const h = buildHarness()

    const first = await getHandler().execute(BASE_INPUT, h.ctx)
    expect(h.seededSessions[0].status).toBe('completed')
    const createCallsAfterFirst = h.commandBusExecute.mock.calls.filter((call) => call[0] === 'sales.quotes.create').length
    expect(createCallsAfterFirst).toBe(1)

    const second = await getHandler().execute(BASE_INPUT, h.ctx)

    expect(second.salesQuoteId).toBe(first.salesQuoteId)
    expect(second.salesOrderId).toBe(first.salesOrderId)
    const createCallsAfterSecond = h.commandBusExecute.mock.calls.filter((call) => call[0] === 'sales.quotes.create').length
    expect(createCallsAfterSecond).toBe(1)
  })

  it('a retry under a DIFFERENT idempotency key still gets the uniform 409 for a non-open session — replay is key-gated', async () => {
    const h = buildHarness()
    await getHandler().execute(BASE_INPUT, h.ctx)

    await expect(getHandler().execute({ ...BASE_INPUT, idempotencyKey: 'a-different-key' }, h.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'session_not_open' }),
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

  // #8268 review / #8821: a synchronously captured gateway payment confirmed the order and
  // completed the session, but left the session's own `CheckoutTransaction` row stuck at
  // `processing` — the transaction-expiry worker would eventually (incorrectly) expire a
  // transaction the buyer already paid for.
  it('gateway sync-captured: advances the CheckoutTransaction to completed, not left at processing', async () => {
    const h = buildHarness()

    await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.seededTransactions).toHaveLength(1)
    expect(h.seededTransactions[0]).toMatchObject({
      status: 'completed',
      paymentStatus: 'captured',
      gatewayTransactionId: 'gateway-txn-1',
    })
  })

  it('records the sync-captured gateway payment once, with the captured amount', async () => {
    const h = buildHarness()

    await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.seededPayments).toHaveLength(1)
    expect(h.seededPayments[0]).toMatchObject({ paymentReference: 'gateway-txn-1', capturedAmount: h.seededPayments[0].amount })
  })

  it('records an authorize-only gateway payment without booking it as captured', async () => {
    const h = buildHarness({ createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'authorized', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'authorized' } } })

    await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.seededPayments).toHaveLength(1)
    expect(h.seededPayments[0].capturedAmount).toBeUndefined()
    expect(h.seededPayments[0].capturedAt).toBeUndefined()
  })

  it('does not record the gateway payment a second time when the same transaction reference is replayed', async () => {
    const h = buildHarness()
    const result = await getHandler().execute(BASE_INPUT, h.ctx)
    expect(h.seededPayments).toHaveLength(1)

    const { confirmOrderAndComplete } = await import('../submit')
    await confirmOrderAndComplete(
      h.ctx.container,
      (h.ctx.container.resolve('em') as never),
      h.seededSessions[0] as never,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      result.salesOrderId as string,
      result.salesQuoteId,
      { stockReservationKey: null, creditReservationKey: null },
      { amount: '10.00', currencyCode: 'USD', paymentReference: 'gateway-txn-1' },
    )

    expect(h.seededPayments).toHaveLength(1)
  })

  it('retries a failed payment record then reports the error, still completing the session', async () => {
    const h = buildHarness({ paymentsCreateError: new Error('409 conflict') })

    await getHandler().execute(BASE_INPUT, h.ctx)

    expect(h.commandBusExecute.mock.calls.filter(([id]) => id === 'sales.payments.create')).toHaveLength(3)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'checkout', code: 'checkout.gateway_payment_record_failed' }),
    )
    expect(h.seededSessions[0].status).toBe('completed')
  })

  it('checks for the cart service before moving the session to submitting or reserving the slot', async () => {
    const h = buildHarness({ cartServiceAvailable: false })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 503,
      body: expect.objectContaining({ code: 'checkout_sessions_unavailable' }),
    })

    expect(h.seededSessions[0].status).toBe('open')
    expect(h.commandBusExecute).not.toHaveBeenCalledWith('availability.reserve', expect.anything())
  })

  it('stops with 409 when recovery already moved the session out of submitting before the awaiting_payment write', async () => {
    const h = buildHarness({ createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'pending', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'pending' } } })
    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock; cancelPayment: jest.Mock }
    const originalCreatePaymentSession = paymentGatewayService.createPaymentSession.getMockImplementation()!
    paymentGatewayService.createPaymentSession.mockImplementation(async (...args: unknown[]) => {
      h.seededSessions[0].status = 'failed'
      return originalCreatePaymentSession(...args)
    })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'submit_in_progress' }),
    })

    expect(h.seededSessions[0].status).toBe('failed')
    expect(h.cartService.unlock).toHaveBeenCalled()
    // #8268 review Medium 8 / review Major 3: the just-created gateway session must not be
    // left live and payable against a session (and order) a concurrent recovery already
    // moved on from. `cancelPayment` resolves a `GatewayTransaction` by primary key — pass
    // the gateway's OWN transaction id (`sessionResult.transaction.id`, 'gw-1'), never the
    // unrelated `CheckoutTransaction` id ('checkout-txn-1'), or the lookup always 404s.
    expect(paymentGatewayService.cancelPayment).toHaveBeenCalledWith('gw-1', 'checkout_submit_recovered', { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(h.seededPayments).toHaveLength(0)
  })

  it('reconciles a captured payment onto the order when the lost-CAS gateway session cannot be cancelled because it already captured', async () => {
    const h = buildHarness({
      createPaymentSessionResult: { transaction: { id: 'gw-1', gatewayPaymentId: 'gw-captured-1', unifiedStatus: 'captured', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'captured' } },
      cancelPaymentError: Object.assign(new Error('Cannot cancel a payment in status "captured"'), { status: 409 }),
    })
    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { cancelPayment: jest.Mock }
    const originalCreatePaymentSession = (h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock }).createPaymentSession.getMockImplementation()!
    ;(h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock }).createPaymentSession.mockImplementation(async (...args: unknown[]) => {
      h.seededSessions[0].status = 'failed'
      return originalCreatePaymentSession(...args)
    })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409 })

    expect(paymentGatewayService.cancelPayment).toHaveBeenCalledWith('gw-1', 'checkout_submit_recovered', { tenantId: TENANT_ID, organizationId: ORG_ID })
    // Money was actually captured despite losing the race — never silently lose track of it.
    expect(h.seededPayments).toHaveLength(1)
    // #8268 review Major 5: always the internal `GatewayTransaction.id` ('gw-1'), never
    // `gatewayPaymentId` ('gw-captured-1') — the capture webhook subscriber writes the
    // SAME internal id onto `CheckoutTransaction.gatewayTransactionId`, so a later
    // reconciliation pass keys on it, not on this diverged external reference.
    expect(h.seededPayments[0]).toMatchObject({ paymentReference: 'gw-1', capturedAmount: h.seededPayments[0].amount })
  })

  // #8268 review Major 5 (re-review): the capture check used the `createPaymentSession`
  // snapshot taken BEFORE the cancel attempt — a capture landing in the race window
  // between that call and the cancel would read as "not captured" from the stale copy and
  // get silently dropped instead of reconciled.
  it('reconciles a capture that landed AFTER the stale snapshot was taken, by re-reading authoritative provider state', async () => {
    const h = buildHarness({
      createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'pending', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'pending' } },
      cancelPaymentError: Object.assign(new Error('Cannot cancel a payment in status "captured"'), { status: 409 }),
      getPaymentStatusResult: { status: 'captured' },
    })
    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock; cancelPayment: jest.Mock; getPaymentStatus: jest.Mock }
    const originalCreatePaymentSession = paymentGatewayService.createPaymentSession.getMockImplementation()!
    paymentGatewayService.createPaymentSession.mockImplementation(async (...args: unknown[]) => {
      h.seededSessions[0].status = 'failed'
      return originalCreatePaymentSession(...args)
    })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409 })

    expect(paymentGatewayService.getPaymentStatus).toHaveBeenCalledWith('gw-1', { tenantId: TENANT_ID, organizationId: ORG_ID })
    // The stale snapshot said 'pending' — only the fresh re-read (`captured`) must drive
    // whether the payment gets reconciled onto the order.
    expect(h.seededPayments).toHaveLength(1)
    expect(h.seededPayments[0]).toMatchObject({ paymentReference: 'gw-1' })
  })

  it('leaves a genuinely failed cancel to the gateway status poller instead of recording a payment or crashing', async () => {
    const h = buildHarness({
      createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'pending', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'pending' } },
      cancelPaymentError: new Error('gateway unreachable'),
      getPaymentStatusResult: { status: 'pending' },
    })
    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock; cancelPayment: jest.Mock; getPaymentStatus: jest.Mock }
    const originalCreatePaymentSession = paymentGatewayService.createPaymentSession.getMockImplementation()!
    paymentGatewayService.createPaymentSession.mockImplementation(async (...args: unknown[]) => {
      h.seededSessions[0].status = 'failed'
      return originalCreatePaymentSession(...args)
    })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409 })

    expect(paymentGatewayService.getPaymentStatus).toHaveBeenCalledWith('gw-1', { tenantId: TENANT_ID, organizationId: ORG_ID })
    // Still pending/authorized (never a terminal status) — this transaction remains
    // selectable by `payment_gateways:status-poller`'s own periodic re-sync, so nothing
    // here needs to persist its own retry.
    expect(h.seededPayments).toHaveLength(0)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'checkout', code: 'checkout.recovered_submit_cancel_failed' }),
    )
  })

  it('falls back to the pre-cancel snapshot when the gateway status re-read itself fails', async () => {
    const h = buildHarness({
      createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'captured', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'captured' } },
      cancelPaymentError: Object.assign(new Error('Cannot cancel a payment in status "captured"'), { status: 409 }),
    })
    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock; cancelPayment: jest.Mock; getPaymentStatus: jest.Mock }
    paymentGatewayService.getPaymentStatus.mockRejectedValueOnce(new Error('status endpoint unreachable'))
    const originalCreatePaymentSession = paymentGatewayService.createPaymentSession.getMockImplementation()!
    paymentGatewayService.createPaymentSession.mockImplementation(async (...args: unknown[]) => {
      h.seededSessions[0].status = 'failed'
      return originalCreatePaymentSession(...args)
    })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409 })

    // The re-read itself failed, so the pre-cancel snapshot ('captured') still drives the
    // decision — the money is still reconciled, never silently dropped.
    expect(h.seededPayments).toHaveLength(1)
  })

  // #8268 review Major 4 (re-review): even when `recordGatewayPayment`'s 3 in-process
  // attempts ALL fail, the capture must not disappear — the CheckoutTransaction itself
  // has to durably flip to `completed` so a later `repair-gateway-payments` sweep (which
  // only selects `status: 'completed'` transactions) can find and retry it, without
  // relying on a provider webhook ever arriving.
  it('persists the capture onto the CheckoutTransaction even when every recordGatewayPayment attempt fails, so repair can find it later', async () => {
    const harnessOpts = {
      createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'pending', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'pending' } },
      cancelPaymentError: Object.assign(new Error('Cannot cancel a payment in status "captured"'), { status: 409 }),
      getPaymentStatusResult: { status: 'captured' },
      paymentsCreateError: new Error('sales ledger unreachable') as Error | undefined,
    }
    const h = buildHarness(harnessOpts)
    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock }
    const originalCreatePaymentSession = paymentGatewayService.createPaymentSession.getMockImplementation()!
    paymentGatewayService.createPaymentSession.mockImplementation(async (...args: unknown[]) => {
      h.seededSessions[0].status = 'failed'
      return originalCreatePaymentSession(...args)
    })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409 })

    // `recordGatewayPayment` exhausted every attempt — no SalesPayment row exists yet —
    // but the transaction must still be durably marked `completed` with the gateway's
    // reference, exactly as the synchronous-capture happy path does.
    expect(h.seededPayments).toHaveLength(0)
    expect(h.seededTransactions[0]).toMatchObject({ status: 'completed', gatewayTransactionId: 'gw-1' })
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'checkout', code: 'checkout.gateway_payment_record_failed' }),
    )

    // A later repair sweep (its real selection query only matches `status: 'completed'`
    // transactions) retries the SAME primitive against the now-durable row and succeeds —
    // no provider webhook required. The ledger is healthy again by the time repair runs.
    harnessOpts.paymentsCreateError = undefined
    const { repairOneGatewayPayment } = await import('../../workers/repair-gateway-payments.worker')
    const em = h.ctx.container.resolve('em') as FakeRow
    // The harness's own `findOne` mock only resolves `CheckoutTransaction` (nothing in the
    // rest of this suite needs a `CheckoutSession` lookup); the repair worker needs both.
    ;(em.findOne as jest.Mock).mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CheckoutSession) return h.seededSessions.find((row) => matchesWhere(row, where)) ?? null
      if (entity === CheckoutTransaction) return h.seededTransactions.find((row) => matchesWhere(row, where)) ?? null
      return null
    })
    await repairOneGatewayPayment(h.ctx.container, em as never, h.seededTransactions[0] as never, { tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(h.seededPayments).toHaveLength(1)
    expect(h.seededPayments[0]).toMatchObject({ paymentReference: 'gw-1', capturedAmount: h.seededPayments[0].amount })
  })

  it('extends the cart lock to the gateway payment expiry PLUS a 15-minute margin (spec R11/§6)', async () => {
    const paymentExpiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const h = buildHarness({
      createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'pending', expiresAt: paymentExpiresAt }, session: { sessionId: 'gw-session-1', status: 'pending' } },
    })

    await getHandler().execute(BASE_INPUT, h.ctx)

    const lastLockCall = h.cartService.lock.mock.calls[h.cartService.lock.mock.calls.length - 1][0]
    const expectedTtlMs = paymentExpiresAt.getTime() + 15 * 60 * 1000 - Date.now()
    expect(lastLockCall.lockTtlMs).toBeGreaterThan(expectedTtlMs - 5_000)
    expect(lastLockCall.lockTtlMs).toBeLessThanOrEqual(expectedTtlMs + 5_000)
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
    // Finding 7: fresh lock (step 1) + the pre-gateway payment-window guess (step 7, C1)
    // + the corrective re-lock to the gateway's OWN `paymentExpiresAt`, once it is known.
    expect(h.cartService.lock).toHaveBeenCalledTimes(3)
    const lastLockCall = h.cartService.lock.mock.calls[2][0]
    expect(lastLockCall.lockTtlMs).toBeGreaterThan(0)
    expect(lastLockCall.lockTtlMs).toBeLessThanOrEqual(86_400_000)
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

  it('returns the gateway hand-off (redirectUrl/clientSecret) on a still-pending status — a buyer on a redirect gateway must receive something to pay with', async () => {
    const h = buildHarness({
      createPaymentSessionResult: {
        transaction: { id: 'gw-1', unifiedStatus: 'pending', expiresAt: null },
        session: { sessionId: 'gw-session-1', status: 'pending', redirectUrl: 'https://gateway.example.com/pay/abc', clientSecret: null },
      },
    })

    const result = await getHandler().execute(BASE_INPUT, h.ctx)

    expect(result.paymentHandoff).toMatchObject({
      redirectUrl: 'https://gateway.example.com/pay/abc',
      clientSecret: null,
      providerKey: BASE_INPUT.paymentMethodCode,
    })
  })

  it('forwards successUrl/cancelUrl from the submit input to createPaymentSession', async () => {
    const h = buildHarness({ createPaymentSessionResult: { transaction: { id: 'gw-1', unifiedStatus: 'pending', expiresAt: null }, session: { sessionId: 'gw-session-1', status: 'pending' } } })
    const paymentGatewayService = h.ctx.container.resolve('paymentGatewayService') as { createPaymentSession: jest.Mock }

    const previousAppUrl = process.env.APP_URL
    process.env.APP_URL = 'https://shop.example.com'
    try {
      await getHandler().execute({ ...BASE_INPUT, successUrl: '/checkout/success', cancelUrl: '/checkout/cancel' }, h.ctx)
    } finally {
      if (previousAppUrl === undefined) delete process.env.APP_URL
      else process.env.APP_URL = previousAppUrl
    }

    expect(paymentGatewayService.createPaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({ successUrl: 'https://shop.example.com/checkout/success', cancelUrl: 'https://shop.example.com/checkout/cancel' }),
    )
  })

  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example',
    'javascript:alert(1)',
  ])('rejects the external or protocol-relative return URL %s before any side effect', async (badUrl) => {
    const h = buildHarness()

    await expect(
      getHandler().execute({ ...BASE_INPUT, successUrl: badUrl }, h.ctx),
    ).rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'invalid_return_url' }) })

    expect(h.seededSessions[0].status).toBe('open')
    expect(h.cartService.lock).not.toHaveBeenCalled()
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

describe('checkout.session.submit — pay-link slot ownership and unexpected-failure compensation', () => {
  beforeAll(async () => {
    await import('../submit')
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  function slotCalls(h: Harness, kind: 'reserve' | 'release') {
    return h.emExecute.mock.calls.filter(([sql]) => (
      typeof sql === 'string'
      && (kind === 'reserve'
        ? sql.includes('active_reservation_count = active_reservation_count + 1')
        : sql.includes('GREATEST(active_reservation_count - 1, 0)'))
    ))
  }

  it('claims the link slot when submit starts and converts it into exactly one completion on a synchronous capture', async () => {
    const h = buildHarness({ session: makeSession({ linkId: 'link-1' }) })

    await getHandler().execute(BASE_INPUT, h.ctx)

    expect(slotCalls(h, 'reserve')).toHaveLength(1)
    const releases = slotCalls(h, 'release')
    expect(releases).toHaveLength(1)
    expect(releases[0][1]).toEqual([1, 'link-1', ORG_ID, TENANT_ID])
  })

  it('does not claim a link slot for a session that has no link', async () => {
    const h = buildHarness()

    await getHandler().execute(BASE_INPUT, h.ctx)

    expect(slotCalls(h, 'reserve')).toHaveLength(0)
    expect(slotCalls(h, 'release')).toHaveLength(0)
  })

  it('422s without touching the session when the link has no capacity left at submit', async () => {
    const h = buildHarness({ session: makeSession({ linkId: 'link-1' }) })
    h.emExecute.mockResolvedValueOnce([])

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'checkout_link_unavailable' }),
    })

    expect(h.seededSessions[0].status).toBe('open')
    expect(h.cartService.lock).not.toHaveBeenCalled()
  })

  it('releases the slot exactly once when a failed attempt is compensated back to open', async () => {
    const h = buildHarness({ session: makeSession({ linkId: 'link-1' }), reserveResult: { reserved: false, shortfall: [] } })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toMatchObject({ status: 409 })

    expect(slotCalls(h, 'reserve')).toHaveLength(1)
    const releases = slotCalls(h, 'release')
    expect(releases).toHaveLength(1)
    expect(releases[0][1]).toEqual([0, 'link-1', ORG_ID, TENANT_ID])
    expect(h.seededSessions[0].status).toBe('open')
  })

  it('a second finalizer that loses the status compare-and-swap neither completes nor releases the slot again', async () => {
    const { confirmOrderAndComplete } = await import('../submit')
    const h = buildHarness({
      session: makeSession({ linkId: 'link-1', status: 'awaiting_payment', salesOrderId: 'order-1', salesQuoteId: 'quote-1' }),
      seededOrders: [{ id: 'order-1', tenant_id: TENANT_ID, organization_id: ORG_ID, deleted_at: null }],
    })
    const em = h.ctx.container.resolve('em') as FakeRow
    const session = h.seededSessions[0] as never
    const keys = { stockReservationKey: null, creditReservationKey: null }
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }

    await confirmOrderAndComplete(h.ctx.container, em as never, session, scope, 'order-1', 'quote-1', keys)
    await confirmOrderAndComplete(h.ctx.container, em as never, session, scope, 'order-1', 'quote-1', keys)

    expect(slotCalls(h, 'release')).toHaveLength(1)
  })

  it('a cancel that loses the CAS to a completed session has no side effects and releases nothing', async () => {
    const { compensateByCancellingOrder } = await import('../submit')
    const h = buildHarness({ session: makeSession({ linkId: 'link-1', status: 'completed', salesOrderId: 'order-1' }) })
    const em = h.ctx.container.resolve('em') as FakeRow

    const cancelled = await compensateByCancellingOrder(
      h.ctx.container,
      em as never,
      h.seededSessions[0] as never,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'order-1',
      'payment_failed',
    )

    expect(cancelled).toBe(false)
    expect(slotCalls(h, 'release')).toHaveLength(0)
    expect(h.commandBusExecute).not.toHaveBeenCalledWith('sales.orders.update', expect.anything())
    expect(h.cartService.unlock).not.toHaveBeenCalled()
  })

  // #8268 review Major 2: cancellation failures used to release the cart/slot and
  // finalize the session UNCONDITIONALLY, with a bare `logger.error` the only trace — a
  // transient `sales.orders.update` failure left a live order permanently behind a
  // session already marked terminal, with nothing ever retrying it.
  it('retries the order cancel on a transient failure, then finalizes once it succeeds', async () => {
    // `submitProgress: 'compensating'` matches the precondition a real caller of this
    // function (the live retry inside `compensateByCancellingOrder`, or a durable repair
    // sweep) always already holds via its own claim CAS before reaching here.
    const h = buildHarness({ session: makeSession({ linkId: 'link-1', status: 'failed', submitProgress: 'compensating', salesOrderId: 'order-1' }), seededOrders: [{ id: 'order-1', tenant_id: TENANT_ID, organization_id: ORG_ID, deleted_at: null }] })
    const { resumeOrderCancellationCompensation } = await import('../submit')
    const em = h.ctx.container.resolve('em') as FakeRow
    const original = h.commandBusExecute.getMockImplementation()!
    let cancelAttempts = 0
    h.commandBusExecute.mockImplementation(async (id: string, options: { input: unknown }) => {
      if (id === 'sales.orders.update') {
        cancelAttempts += 1
        if (cancelAttempts < 2) throw new Error('transient db error')
      }
      return original(id, options as never)
    })

    const resumed = await resumeOrderCancellationCompensation(
      h.ctx.container,
      em as never,
      h.seededSessions[0] as never,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'order-1',
      'payment_failed',
    )

    expect(resumed).toBe(true)
    expect(cancelAttempts).toBe(2)
    expect(h.cartService.unlock).toHaveBeenCalledTimes(1)
    expect(h.seededSessions[0].submitProgress).toBeNull()
  })

  // #8268 review Major 2 (re-review): the durable `submitProgress: 'compensating'`
  // marker used to clear BEFORE the slot release ran, so a release failure (or a crash
  // right there) left the marker already null — the repair sweep (which only selects
  // `submitProgress: 'compensating'`) could never find that session again, and the slot
  // stayed permanently reserved.
  it('a slot-release failure leaves submitProgress at compensating (retryable) instead of finalizing', async () => {
    const h = buildHarness({ session: makeSession({ linkId: 'link-1', status: 'failed', submitProgress: 'compensating', salesOrderId: 'order-1' }), seededOrders: [{ id: 'order-1', tenant_id: TENANT_ID, organization_id: ORG_ID, deleted_at: null }] })
    const { resumeOrderCancellationCompensation } = await import('../submit')
    const em = h.ctx.container.resolve('em') as FakeRow
    h.emExecute.mockImplementationOnce(async () => { throw new Error('db connection lost') })

    const resumed = await resumeOrderCancellationCompensation(
      h.ctx.container,
      em as never,
      h.seededSessions[0] as never,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'order-1',
      'payment_failed',
    )

    expect(resumed).toBe(false)
    expect(h.seededSessions[0].submitProgress).toBe('compensating')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'checkout', code: 'checkout.compensation_release_failed' }),
    )
  })

  it('a retry that finds the session already finalized does not release the slot a second time', async () => {
    // Simulates a retry landing AFTER a previous attempt already committed the slot
    // release and cleared the marker (a winning concurrent caller, or this session's own
    // prior successful run) — `submitProgress` is no longer `'compensating'`, so the CAS
    // inside the bundled transaction affects zero rows and the slot release must never
    // even be attempted.
    const h = buildHarness({ session: makeSession({ linkId: 'link-1', status: 'failed', submitProgress: null, salesOrderId: 'order-1' }), seededOrders: [{ id: 'order-1', tenant_id: TENANT_ID, organization_id: ORG_ID, deleted_at: null }] })
    const { resumeOrderCancellationCompensation } = await import('../submit')
    const em = h.ctx.container.resolve('em') as FakeRow

    const resumed = await resumeOrderCancellationCompensation(
      h.ctx.container,
      em as never,
      h.seededSessions[0] as never,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'order-1',
      'payment_failed',
    )

    expect(resumed).toBe(true)
    expect(slotCalls(h, 'release')).toHaveLength(0)
  })

  it('treats a cart.unlock 404 as already-unlocked (not a hard failure) and still finalizes', async () => {
    // `cart.unlock` (§9) throws the SAME uniform 404 whether the cart is missing or
    // simply no longer `locked` — exactly what a retry after an earlier successful
    // unlock looks like. This must not wedge the session on `submitProgress:
    // 'compensating'` forever.
    const h = buildHarness({ session: makeSession({ linkId: 'link-1', status: 'failed', submitProgress: 'compensating', salesOrderId: 'order-1' }), seededOrders: [{ id: 'order-1', tenant_id: TENANT_ID, organization_id: ORG_ID, deleted_at: null }] })
    const { resumeOrderCancellationCompensation } = await import('../submit')
    const em = h.ctx.container.resolve('em') as FakeRow
    h.cartService.unlock.mockRejectedValueOnce(notFound('[internal] cart not found'))

    const resumed = await resumeOrderCancellationCompensation(
      h.ctx.container,
      em as never,
      h.seededSessions[0] as never,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'order-1',
      'payment_failed',
    )

    expect(resumed).toBe(true)
    expect(h.seededSessions[0].submitProgress).toBeNull()
    expect(slotCalls(h, 'release')).toHaveLength(1)
  })

  // #8268 review Major 2 (re-review): a cart.unlock rejection that is NOT the uniform
  // 404 (a transient DB/command failure before the unlock actually commits) must leave
  // the cart locked and the session retryable — finalizing anyway would clear
  // `submitProgress: 'compensating'` while nothing had actually released the cart, and
  // the repair sweep (which only selects that marker) could never find the session again.
  it('leaves submitProgress at compensating (retryable) when cart.unlock fails for a non-404 reason', async () => {
    const h = buildHarness({ session: makeSession({ linkId: 'link-1', status: 'failed', submitProgress: 'compensating', salesOrderId: 'order-1' }), seededOrders: [{ id: 'order-1', tenant_id: TENANT_ID, organization_id: ORG_ID, deleted_at: null }] })
    const { resumeOrderCancellationCompensation } = await import('../submit')
    const em = h.ctx.container.resolve('em') as FakeRow
    h.cartService.unlock.mockRejectedValueOnce(new Error('db connection lost'))

    const resumed = await resumeOrderCancellationCompensation(
      h.ctx.container,
      em as never,
      h.seededSessions[0] as never,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'order-1',
      'payment_failed',
    )

    expect(resumed).toBe(false)
    expect(h.seededSessions[0].submitProgress).toBe('compensating')
    expect(slotCalls(h, 'release')).toHaveLength(0)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'checkout', code: 'checkout.compensation_unlock_failed' }),
    )
  })

  it('leaves the session retryable (submitProgress: compensating) and reports the error when every cancel attempt fails', async () => {
    const h = buildHarness({ session: makeSession({ linkId: 'link-1', status: 'submitting', salesOrderId: 'order-1' }), seededOrders: [{ id: 'order-1', tenant_id: TENANT_ID, organization_id: ORG_ID, deleted_at: null }] })
    const em = h.ctx.container.resolve('em') as FakeRow
    const original = h.commandBusExecute.getMockImplementation()!
    h.commandBusExecute.mockImplementation(async (id: string, options: { input: unknown }) => {
      if (id === 'sales.orders.update') throw new Error('order cancel permanently down')
      return original(id, options as never)
    })

    const { compensateByCancellingOrder } = await import('../submit')
    const cancelled = await compensateByCancellingOrder(
      h.ctx.container,
      em as never,
      h.seededSessions[0] as never,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'order-1',
      'payment_failed',
    )

    expect(cancelled).toBe(true)
    expect(h.seededSessions[0].status).toBe('failed')
    // Never finalized: a live order's reservations must stay held, not silently released,
    // until the cancel actually succeeds.
    expect(h.seededSessions[0].submitProgress).toBe('compensating')
    expect(h.cartService.unlock).not.toHaveBeenCalled()
    expect(slotCalls(h, 'release')).toHaveLength(0)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'checkout', code: 'checkout.compensation_cancel_failed' }),
    )
  })

  it('compensates (stock released, cart unlocked, session reopened) when availability.reserve throws unexpectedly', async () => {
    const h = buildHarness({ session: makeSession({ linkId: 'link-1' }) })
    const original = h.commandBusExecute.getMockImplementation()!
    h.commandBusExecute.mockImplementation(async (id: string, options: { input: unknown }) => {
      if (id === 'availability.reserve') throw new Error('reserve exploded')
      return original(id, options as never)
    })

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toThrow('reserve exploded')

    expect(h.cartService.unlock).toHaveBeenCalledTimes(1)
    expect(h.commandBusExecute).toHaveBeenCalledWith('availability.release', expect.anything())
    expect(h.seededSessions[0].status).toBe('open')
    expect(slotCalls(h, 'release')).toHaveLength(1)
  })

  it('compensates when sales.quotes.create throws unexpectedly, releasing credit for an on_account attempt', async () => {
    const h = buildHarness()
    const original = h.commandBusExecute.getMockImplementation()!
    h.commandBusExecute.mockImplementation(async (id: string, options: { input: unknown }) => {
      if (id === 'sales.quotes.create') throw new Error('quote exploded')
      return original(id, options as never)
    })

    await expect(getHandler().execute({ ...BASE_INPUT, paymentMethodCode: 'on_account' }, h.ctx)).rejects.toThrow('quote exploded')

    expect(h.customerCreditService?.releaseCredit).toHaveBeenCalledTimes(1)
    expect(h.cartService.unlock).toHaveBeenCalledTimes(1)
    expect(h.seededSessions[0].status).toBe('open')
  })

  it('compensates when the totals calculation throws unexpectedly, and never double-compensates an already-compensated failure', async () => {
    const h = buildHarness()
    h.salesCalculationService.calculateDocumentTotals.mockRejectedValueOnce(new Error('totals exploded'))

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toThrow('totals exploded')

    expect(h.cartService.unlock).toHaveBeenCalledTimes(1)
    expect(h.seededSessions[0].status).toBe('open')

    const mismatch = buildHarness({ goodsCalcTotals: { ...SNAPSHOT_TOTALS, grandTotalGrossAmount: 999 } })
    await expect(getHandler().execute(BASE_INPUT, mismatch.ctx)).rejects.toMatchObject({ status: 500 })
    expect(mismatch.cartService.unlock).toHaveBeenCalledTimes(1)
  })

  it('compensates when the delivery re-evaluation throws unexpectedly', async () => {
    const h = buildHarness()
    mockEvaluateDeliveryDiscount.mockRejectedValueOnce(new Error('delivery exploded'))

    await expect(getHandler().execute(BASE_INPUT, h.ctx)).rejects.toThrow('delivery exploded')

    expect(h.cartService.unlock).toHaveBeenCalledTimes(1)
    expect(h.seededSessions[0].status).toBe('open')
  })
})
