type Row = Record<string, any>

let seededPriceRows: Row[] = []

const mockFindWithDecryption = jest.fn(async () => [...seededPriceRows])

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { Cart, CartLine } from '../../data/entities'
import {
  buildCartLineRepricePhases,
  buildRecomputeCartTotalsPhase,
  toCartTotalsLineSnapshot,
} from '../reprice'
import type { CartPriceChange } from '../reprice'

const TENANT_ID = 'tenant-cart-1'
const ORG_ID = 'org-cart-1'

function makeCart(overrides: Row = {}): Cart {
  return {
    id: 'cart-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    channel: 'storefront',
    currencyCode: 'USD',
    customerId: null,
    customerIds: [],
    customerGroupIds: [],
    priceKindId: null,
    salesChannelId: null,
    ...overrides,
  } as Cart
}

function makeLine(overrides: Row = {}): CartLine {
  return {
    id: 'line-1',
    cartId: 'cart-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    productId: 'product-1',
    variantId: null,
    name: 'Widget',
    quantity: '2',
    quantityUnit: null,
    unitPriceNet: '10',
    unitPriceGross: '12',
    taxRate: '20',
    priceKindId: null,
    priceRowId: 'price-row-1',
    priceTierMinQuantity: 1,
    pricedAt: new Date('2026-01-01T00:00:00.000Z'),
    lineTotals: {},
    discountTotalNet: null,
    configuration: null,
    ...overrides,
  } as CartLine
}

function makeResolvedLinePrice(overrides: Row = {}) {
  return {
    priceRow: { id: 'price-row-2' },
    amountNet: 8,
    amountGross: 9.6,
    taxRatePercent: 20,
    priceIsPromotional: false,
    currentTier: { minQuantity: 10, maxQuantity: null, amountNet: 8, amountGross: 9.6 },
    nextTier: null,
    tiers: [],
    ...overrides,
  }
}

function makeContainer(opts: {
  resolveLinePrice?: jest.Mock
  calculateLine?: jest.Mock
  calculateDocumentTotals?: jest.Mock
  // Step 3.1 (K1/K2) — undefined by default, matching every token this fake container did
  // not already know: `buildRecomputeCartTotalsPhase` defensively `tryResolve`s
  // `customerGroupsService` (`../approvalGate.ts`), so every EXISTING test below (none of
  // which pass this) keeps hitting the `Unexpected DI token` throw, caught internally,
  // degrading `cart.requiresApproval` to `false` exactly as before this Step.
  customerGroupsService?: unknown
}) {
  const resolveLinePrice = opts.resolveLinePrice ?? jest.fn(async () => makeResolvedLinePrice())
  const calculateLine = opts.calculateLine ?? jest.fn(async ({ line }: any) => ({
    line,
    netAmount: line.quantity * (line.unitPriceNet ?? 0),
    grossAmount: line.quantity * (line.unitPriceGross ?? 0),
    taxAmount: 0,
    discountAmount: 0,
    adjustments: [],
  }))
  const calculateDocumentTotals = opts.calculateDocumentTotals ?? jest.fn(async () => ({
    kind: 'quote',
    currencyCode: 'USD',
    lines: [],
    adjustments: [],
    totals: {
      subtotalNetAmount: 16,
      subtotalGrossAmount: 19.2,
      discountTotalAmount: 0,
      taxTotalAmount: 3.2,
      grandTotalNetAmount: 16,
      grandTotalGrossAmount: 19.2,
    },
    metadata: {},
  }))
  return {
    resolve: (token: string): any => {
      if (token === 'catalogBuyerPricingService') return { resolveLinePrice }
      if (token === 'salesCalculationService') return { calculateLine, calculateDocumentTotals }
      if (token === 'customerGroupsService') {
        if (opts.customerGroupsService !== undefined) return opts.customerGroupsService
        throw new Error(`Unexpected DI token: ${token}`)
      }
      throw new Error(`Unexpected DI token: ${token}`)
    },
    resolveLinePrice,
    calculateLine,
    calculateDocumentTotals,
  }
}

const em = {} as any

beforeEach(() => {
  seededPriceRows = [{ id: 'price-row-2', tenantId: TENANT_ID, organizationId: ORG_ID }]
  jest.clearAllMocks()
})

describe('buildCartLineRepricePhases', () => {
  it('re-snapshots every line, collects a priceChange only when the amount actually moved, and tracks touched lines', async () => {
    const cart = makeCart()
    const changedLine = makeLine({ id: 'line-1' })
    // `unit_price_net`/`unit_price_gross` are `numeric(_, 4)` columns, so a real row read
    // back from Postgres always carries 4 decimal places — '8.0000', never the bare '8' the
    // resolved mock price below (`amountNet: 8`) would naively stringify to. Formatted
    // explicitly here so this line genuinely proves "no real price movement", the same
    // false-positive this function's `formatDecimalAmount` fix closes.
    const unchangedLine = makeLine({ id: 'line-2', unitPriceNet: '8.0000', unitPriceGross: '9.6000' })
    const container = makeContainer({})

    const changes: CartPriceChange[] = []
    const touched: CartLine[] = []
    const phases = buildCartLineRepricePhases(em, container, cart, [changedLine, unchangedLine], 'stale_snapshot', new Date('2026-02-01T00:00:00.000Z'), changes, touched)

    expect(phases).toHaveLength(2)
    for (const phase of phases) await phase()

    expect(touched).toHaveLength(2)
    expect(changedLine.unitPriceNet).toBe('8.0000')
    expect(changedLine.unitPriceGross).toBe('9.6000')
    expect(changedLine.priceRowId).toBe('price-row-2')
    expect(unchangedLine.unitPriceNet).toBe('8.0000')
    expect(unchangedLine.unitPriceGross).toBe('9.6000')
    expect(changes).toEqual([
      {
        lineId: 'line-1',
        productId: 'product-1',
        oldUnitPriceNet: '10',
        newUnitPriceNet: '8.0000',
        oldUnitPriceGross: '12',
        newUnitPriceGross: '9.6000',
        reason: 'stale_snapshot',
      },
    ])
  })

  it('leaves a line untouched when no price row resolves for it (product withdrawn mid-cart)', async () => {
    const cart = makeCart()
    const line = makeLine()
    const container = makeContainer({ resolveLinePrice: jest.fn(async () => makeResolvedLinePrice({ priceRow: null })) })

    const changes: CartPriceChange[] = []
    const touched: CartLine[] = []
    const phases = buildCartLineRepricePhases(em, container, cart, [line], 'stale_snapshot', new Date(), changes, touched)
    for (const phase of phases) await phase()

    expect(touched).toHaveLength(0)
    expect(changes).toHaveLength(0)
    expect(line.unitPriceNet).toBe('10')
  })

  it('returns an empty phase list for an empty line set', () => {
    const cart = makeCart()
    const container = makeContainer({})
    const phases = buildCartLineRepricePhases(em, container, cart, [], 'stale_snapshot', new Date(), [], [])
    expect(phases).toHaveLength(0)
  })

  // Step 7.1 — §4.2/§6a.2: a flagged line is excluded from re-pricing; a gift (origin:
  // 'promotion') line is excluded too, so the promotions phase's deliberate `unitPriceNet/
  // Gross: '0'` snapshot is never silently overwritten by a real catalog price on the next
  // re-price trigger.
  it('excludes a flagged line and a promotion-origin (gift) line from re-pricing', async () => {
    const cart = makeCart()
    const pricableLine = makeLine({ id: 'line-1' })
    const flaggedLine = makeLine({ id: 'line-2', flagState: 'product_unavailable' })
    const giftLine = makeLine({ id: 'line-3', origin: 'promotion', promotionId: 'promo-1', unitPriceNet: '0', unitPriceGross: '0' })
    const container = makeContainer({})

    const changes: CartPriceChange[] = []
    const touched: CartLine[] = []
    const phases = buildCartLineRepricePhases(
      em,
      container,
      cart,
      [pricableLine, flaggedLine, giftLine],
      'stale_snapshot',
      new Date('2026-02-01T00:00:00.000Z'),
      changes,
      touched,
    )

    // Step 7.4 — the gift (`origin: 'promotion'`) line is still excluded EAGERLY (one phase
    // per non-gift line); the flagged line now gets its OWN phase too, built eagerly, but
    // that phase checks `flagState` again at its own execution time and no-ops — see
    // `buildCartLineRepricePhases`'s own doc comment for why (§6a.2's whole-cart
    // re-visibility pass, run by an EARLIER phase in the same `withAtomicFlush` sequence,
    // may flag a line AFTER this function was already called to build the phase array).
    expect(phases).toHaveLength(2)
    for (const phase of phases) await phase()

    expect(touched).toEqual([pricableLine])
    expect(flaggedLine.unitPriceNet).toBe('10')
    expect(giftLine.unitPriceNet).toBe('0')
  })

  // Release 5, Step 3.5 (D-R5-19) — a trusted pay-link line carrying `unitPriceOverride`
  // is excluded EAGERLY, the identical reasoning as the gift-line exclusion above: running
  // it through catalog resolution would silently overwrite the merchant's fixed price with
  // the real catalog price on the very next re-price trigger (a buyer login, a currency
  // change, staleness).
  it('excludes a unitPriceOverride line from re-pricing, same as a gift line', async () => {
    const cart = makeCart()
    const pricableLine = makeLine({ id: 'line-1' })
    const overrideLine = makeLine({
      id: 'line-2',
      unitPriceOverride: { amount: '49.00', basis: 'gross' },
      unitPriceNet: null,
      unitPriceGross: '49',
      priceRowId: null,
    })
    const container = makeContainer({})

    const changes: CartPriceChange[] = []
    const touched: CartLine[] = []
    const phases = buildCartLineRepricePhases(
      em,
      container,
      cart,
      [pricableLine, overrideLine],
      'stale_snapshot',
      new Date('2026-02-01T00:00:00.000Z'),
      changes,
      touched,
    )

    expect(phases).toHaveLength(1)
    for (const phase of phases) await phase()

    expect(touched).toEqual([pricableLine])
    expect(overrideLine.unitPriceGross).toBe('49')
    expect(overrideLine.priceRowId).toBeNull()
  })

  // QA F14 — `fetchLinePriceRows`'s `targetClause` is `{ $or: [{ product: productId }, {
  // variant: variantId }] }`, and every variant's price row ALSO carries the parent
  // `product_id` (not just `variant_id`), so the `{ product: productId }` arm returns every
  // sibling variant's rows too. `mockFindWithDecryption` returns ALL seeded rows regardless
  // of the query, standing in for that over-wide real-DB result; the regression is proven by
  // asserting what `fetchLinePriceRows` hands to `resolveLinePrice` for each line, not by the
  // resolved price (which is mocked here) — each line must see ONLY its own variant's row
  // (plus any product-level row), never a sibling variant's.
  it('TC-CART-PRICE-F14: narrows price rows to each line\'s own variant before resolving', async () => {
    const cart = makeCart()
    const lineForVariantA = makeLine({ id: 'line-a', variantId: 'variant-a' })
    const lineForVariantB = makeLine({ id: 'line-b', variantId: 'variant-b' })

    seededPriceRows = [
      { id: 'price-row-variant-a', tenantId: TENANT_ID, organizationId: ORG_ID, variant: 'variant-a' },
      { id: 'price-row-variant-b', tenantId: TENANT_ID, organizationId: ORG_ID, variant: 'variant-b' },
    ]

    const capturedRows: Row[][] = []
    const resolveLinePrice = jest.fn(async (_em: unknown, rows: Row[]) => {
      capturedRows.push(rows)
      return makeResolvedLinePrice({ priceRow: rows[0] ?? null })
    })
    const container = makeContainer({ resolveLinePrice })

    const changes: CartPriceChange[] = []
    const touched: CartLine[] = []
    const phases = buildCartLineRepricePhases(
      em,
      container,
      cart,
      [lineForVariantA, lineForVariantB],
      'stale_snapshot',
      new Date('2026-02-01T00:00:00.000Z'),
      changes,
      touched,
    )
    for (const phase of phases) await phase()

    expect(capturedRows).toHaveLength(2)
    expect(capturedRows[0].map((row) => row.id)).toEqual(['price-row-variant-a'])
    expect(capturedRows[1].map((row) => row.id)).toEqual(['price-row-variant-b'])
  })
})

describe('toCartTotalsLineSnapshot', () => {
  it('maps a CartLine onto a SalesLineSnapshot, net amounts, product kind', () => {
    const line = makeLine()
    const snapshot = toCartTotalsLineSnapshot(line, 'USD')
    expect(snapshot).toMatchObject({
      kind: 'product',
      productId: 'product-1',
      productVariantId: null,
      quantity: 2,
      currencyCode: 'USD',
      unitPriceNet: 10,
      unitPriceGross: 12,
      taxRate: 20,
      discountAmount: null,
      discountAmountBasis: null,
    })
  })

  it('sets discountAmountBasis: line and an absolute discountAmount when discountTotalNet is set (§3.2 rule 1)', () => {
    const line = makeLine({ discountTotalNet: '-12.00' })
    const snapshot = toCartTotalsLineSnapshot(line, 'USD')
    expect(snapshot.discountAmount).toBe(12)
    expect(snapshot.discountAmountBasis).toBe('line')
  })

  // TC-CART-TOT-03/04 (§3.2 rule 1, SPEC-055 A-R6/`TC-PROM-060`) — regression guard for rev
  // 8's withdrawn per-unit-division rule. `discountTotalNet` is already documented (§4.2) as
  // the persisted NET line-total discount, so this mapper has no gross/net branch to get
  // wrong; the one thing it must never do is divide the stored total back out by quantity.
  // No real promotion integration exists in this worktree yet (Phase 3/7) — this feeds a
  // synthetic `CartLine.discountTotalNet`, the shape a future promotion-applied line would
  // carry, straight at the mapper under test.
  it('TC-CART-TOT-04: a multi-unit line carries its discountTotalNet as-is, never divided by quantity', () => {
    const line = makeLine({ quantity: '5', discountTotalNet: '-12.40' })
    const snapshot = toCartTotalsLineSnapshot(line, 'USD')
    expect(snapshot.discountAmountBasis).toBe('line')
    expect(snapshot.discountAmount).toBe(12.4)
    // Pins the exact regression rev 8's rule produced: 12.40 / 5 = 2.48 must NOT be the result.
    expect(snapshot.discountAmount).not.toBeCloseTo(12.4 / 5)
  })

  it('TC-CART-TOT-04: discountAmountBasis is never unset (and never "unit"/omitted) while discountTotalNet is non-null, regardless of quantity', () => {
    for (const quantity of ['1', '3', '7', '12.5']) {
      const line = makeLine({ quantity, discountTotalNet: '-5.00' })
      const snapshot = toCartTotalsLineSnapshot(line, 'USD')
      expect(snapshot.discountAmountBasis).toBe('line')
      expect(snapshot.discountAmount).toBe(5)
    }
  })
})

describe('buildRecomputeCartTotalsPhase', () => {
  it('calls calculateDocumentTotals with documentKind quote and stores the result verbatim onto Cart.totals', async () => {
    const cart = makeCart()
    const line = makeLine()
    const container = makeContainer({})
    const changes: CartPriceChange[] = []
    const now = new Date('2026-02-01T00:00:00.000Z')

    const phase = buildRecomputeCartTotalsPhase(container, cart, [line], now, changes)
    await phase()

    expect(container.calculateDocumentTotals).toHaveBeenCalledTimes(1)
    const callArgs = container.calculateDocumentTotals.mock.calls[0][0]
    expect(callArgs.documentKind).toBe('quote')
    expect(callArgs.adjustments).toEqual([])
    expect(callArgs.lines).toHaveLength(1)

    expect(cart.totals).toEqual({
      subtotalNetAmount: 16,
      subtotalGrossAmount: 19.2,
      discountTotalAmount: 0,
      taxTotalAmount: 3.2,
      grandTotalNetAmount: 16,
      grandTotalGrossAmount: 19.2,
    })
    expect(cart.totalsComputedAt).toBe(now)
  })

  // Step 7.1 — §4.2/§6a.2: a flagged line is excluded from totals.
  it('excludes a flagged line from the lines sent to calculateDocumentTotals', async () => {
    const cart = makeCart()
    const pricableLine = makeLine({ id: 'line-1' })
    const flaggedLine = makeLine({ id: 'line-2', flagState: 'product_unavailable' })
    const container = makeContainer({})
    const now = new Date('2026-02-01T00:00:00.000Z')

    const phase = buildRecomputeCartTotalsPhase(container, cart, [pricableLine, flaggedLine], now, [])
    await phase()

    const callArgs = container.calculateDocumentTotals.mock.calls[0][0]
    expect(callArgs.lines).toHaveLength(1)
    expect(callArgs.lines[0].productId).toBe(pricableLine.productId)
  })

  // Step 7.1 — a `CART_DISCOUNT`-derived adjustment is threaded straight through.
  it('forwards the supplied adjustments array to calculateDocumentTotals, default [] when omitted', async () => {
    const cart = makeCart()
    const line = makeLine()
    const container = makeContainer({})
    const now = new Date('2026-02-01T00:00:00.000Z')
    const adjustments = [
      { scope: 'order' as const, kind: 'discount', promotionId: 'promo-1', amountNet: -5, amountGross: -6, currencyCode: 'USD' },
    ]

    await buildRecomputeCartTotalsPhase(container, cart, [line], now, [], adjustments)()
    expect(container.calculateDocumentTotals.mock.calls[0][0].adjustments).toBe(adjustments)

    const omittedCallContainer = makeContainer({})
    await buildRecomputeCartTotalsPhase(omittedCallContainer, cart, [line], now, [])()
    expect(omittedCallContainer.calculateDocumentTotals.mock.calls[0][0].adjustments).toEqual([])
  })

  it('sets lastPriceChangeAt only when priceChanges is non-empty', async () => {
    const cart = makeCart()
    const line = makeLine()
    const container = makeContainer({})
    const now = new Date('2026-02-01T00:00:00.000Z')

    await buildRecomputeCartTotalsPhase(container, cart, [line], now, [])()
    expect(cart.lastPriceChangeAt).toBeUndefined()

    const changedCart = makeCart()
    await buildRecomputeCartTotalsPhase(container, changedCart, [line], now, [
      { lineId: 'line-1', productId: 'product-1', oldUnitPriceNet: '10', newUnitPriceNet: '8', oldUnitPriceGross: '12', newUnitPriceGross: '9.6', reason: 'stale_snapshot' },
    ])()
    expect(changedCart.lastPriceChangeAt).toBe(now)
  })

  // Step 3.1 (K2, §9a.2) — TC-CART-APR-01: `requiresApproval` is recomputed on EVERY call
  // to this phase (i.e. every totals-changing command: line writes, `cart.reprice` itself,
  // and everything that dispatches `cart.reprice` — merge, promotions, `cart.lock`'s own
  // forced re-price), not only at `cart.lock`. The default `calculateDocumentTotals` stub
  // returns `grandTotalGrossAmount: 19.2` (see `makeContainer`).
  it('recomputes cart.requiresApproval from fresh terms on every call, above and below the threshold', async () => {
    const cart = makeCart()
    const line = makeLine()
    const now = new Date('2026-02-01T00:00:00.000Z')
    const resolveTerms = jest.fn(async () => ({
      priceKindId: null,
      paymentTermsDays: null,
      allowPurchaseOnAccount: false,
      approvalRequiredAbove: 10,
      minOrderValue: null,
      approvalPolicy: 'buyer' as const,
      termsCurrencyCode: 'USD',
      sources: {
        priceKindId: null,
        paymentTermsDays: null,
        allowPurchaseOnAccount: null,
        approvalRequiredAbove: null,
        minOrderValue: null,
        approvalPolicy: null,
        termsCurrencyCode: null,
      },
    }))
    const container = makeContainer({ customerGroupsService: { resolveTerms } })

    await buildRecomputeCartTotalsPhase(container, cart, [line], now, [])()

    // 19.2 (the stub's grandTotalGrossAmount) > 10 (the threshold).
    expect(cart.requiresApproval).toBe(true)
    expect(resolveTerms).toHaveBeenCalledWith({
      customerId: cart.customerId ?? null,
      customerIds: cart.customerIds ?? [],
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
    })

    // A second call with a higher threshold (simulating the group terms changing between
    // calls) brings it back to false — "recomputed... on every totals change," not cached.
    resolveTerms.mockResolvedValueOnce({
      priceKindId: null,
      paymentTermsDays: null,
      allowPurchaseOnAccount: false,
      approvalRequiredAbove: 1000,
      minOrderValue: null,
      approvalPolicy: 'buyer',
      termsCurrencyCode: 'USD',
      sources: {
        priceKindId: null,
        paymentTermsDays: null,
        allowPurchaseOnAccount: null,
        approvalRequiredAbove: null,
        minOrderValue: null,
        approvalPolicy: null,
        termsCurrencyCode: null,
      },
    })
    await buildRecomputeCartTotalsPhase(container, cart, [line], now, [])()
    expect(cart.requiresApproval).toBe(false)
  })

  it('degrades requiresApproval to false, never throwing, when customerGroupsService cannot be resolved (customer_groups absent)', async () => {
    const cart = makeCart()
    const line = makeLine()
    const container = makeContainer({})
    const now = new Date('2026-02-01T00:00:00.000Z')

    await expect(buildRecomputeCartTotalsPhase(container, cart, [line], now, [])()).resolves.toBeUndefined()
    expect(cart.requiresApproval).toBe(false)
  })
})
