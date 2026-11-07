jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

type Row = Record<string, any>

let seededCarts: Row[] = []
let seededCartLines: Row[] = []
let seededPriceRows: Row[] = []
let seededPromotionApplications: Row[] = []
let seededPromotions: Row[] = []

import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { Promotion } from '@open-mercato/core/modules/promotions/data/entities'
import { Cart, CartLine, CartPromotionApplication } from '../../data/entities'

function matchesSimpleWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date) && '$in' in value) {
      return (value as { $in: unknown[] }).$in.includes(row[key])
    }
    return row[key] === (value ?? null)
  })
}

function filterRows(rows: Row[], where: Row): Row[] {
  return rows.filter((row) => matchesSimpleWhere(row, where))
}

const mockFindWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Row) => {
  if (entity === CartLine) return filterRows(seededCartLines, where)
  // Mirrors `commands/__tests__/lines.test.ts`'s own documented simplification: the batched
  // price-row filter is a complex MikroORM query shape this fake store does not
  // re-implement — every call for this entity returns the full seeded set.
  if (entity === CatalogProductPrice) return [...seededPriceRows]
  if (entity === CartPromotionApplication) return filterRows(seededPromotionApplications, where)
  return []
})

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Row) => {
  if (entity === Cart) return filterRows(seededCarts, where)[0] ?? null
  return null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [unknown, unknown, Row])),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Row])),
}))

// Step 5.3 — the availability advisory. Mocked so a test can control the per-item
// `state`/`canFulfil`/`leadTimeDays`/`releaseAt` returned for a given `(productId,
// variantId)` key without wiring the real `catalog-only` provider's policy lookup. The real
// `availabilityItemKey` is kept so the test's own keying matches `cartView.ts`'s.
const mockResolveAvailability = jest.fn(async (query: Row) => ({ byItem: {} as Row }))
jest.mock('@open-mercato/shared/lib/availability', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/availability')
  return {
    ...actual,
    resolveAvailability: (...args: unknown[]) => mockResolveAvailability(...(args as [Row])),
  }
})

import { buildCartResponseEnvelope } from '../cartView'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const TENANT_ID = 'tenant-cart-1'
const ORG_ID = 'org-cart-1'
const CART_ID = 'cart-1'

function makeCartFixture(overrides: Row = {}): Row {
  return {
    id: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'basket',
    status: 'active',
    currencyCode: 'USD',
    locale: 'en-US',
    taxMode: 'gross',
    customerId: null,
    customerIds: [],
    customerGroupIds: [],
    priceKindId: null,
    salesChannelId: null,
    totals: { subtotalNetAmount: 0, subtotalGrossAmount: 0, discountTotalAmount: 0, taxTotalAmount: 0, grandTotalNetAmount: 0, grandTotalGrossAmount: 0 },
    requiresApproval: false,
    approvalId: null,
    awaitingApprovalSince: null,
    expiresAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeLineFixture(overrides: Row = {}): Row {
  return {
    id: 'line-1',
    cartId: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    lineNumber: 1,
    productId: 'product-1',
    variantId: null,
    sku: 'WIDGET-1',
    name: 'Widget',
    optionValues: null,
    quantity: '2',
    quantityUnit: null,
    unitPriceNet: '10',
    unitPriceGross: '12',
    taxRate: '20',
    priceKindId: null,
    priceRowId: 'price-row-1',
    priceTierMinQuantity: 1,
    pricedAt: new Date('2026-02-01T00:00:00.000Z'),
    lineTotals: {},
    discountTotalNet: null,
    promotionId: null,
    origin: 'customer',
    flagState: null,
    configuration: null,
    addedByActorType: 'buyer',
    addedByActorId: null,
    metadata: null,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

function makeResolvedLinePrice(overrides: Row = {}) {
  return {
    priceRow: { id: 'price-row-1' },
    amountNet: 10,
    amountGross: 12,
    taxRatePercent: 20,
    priceIsPromotional: false,
    currentTier: { minQuantity: 1, maxQuantity: 9, amountNet: 10, amountGross: 12 },
    nextTier: null,
    tiers: [],
    ...overrides,
  }
}

function makePromotionApplicationFixture(overrides: Row = {}): Row {
  return {
    id: 'promotion-app-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    cartId: CART_ID,
    promotionId: 'promotion-1',
    code: null,
    codeId: null,
    codeType: null,
    codeReservationId: null,
    scope: 'order',
    cartLineId: null,
    effect: {},
    amountNet: null,
    amountGross: null,
    appliedAt: new Date('2026-02-01T00:00:00.000Z'),
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makePromotionFixture(overrides: Row = {}): Row {
  return {
    id: 'promotion-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Promotion One',
    deletedAt: null,
    ...overrides,
  }
}

// Step 3.2 — `buildCartResponseEnvelope`'s own live approval read
// (`customerPurchaseApprovalService.getApproval`). `null` (unresolvable, same as every
// other optional peer this module soft-resolves) unless a test explicitly opts in via
// `opts.approvalService`.
function makeContainer(opts: { resolveLinePrice?: jest.Mock; approvalService?: { getApproval: jest.Mock } | null } = {}) {
  const resolveLinePrice = opts.resolveLinePrice ?? jest.fn(async () => makeResolvedLinePrice())
  const em: any = { fork: jest.fn() }
  em.fork.mockReturnValue(em)
  // `buildAppliedPromotionViews`'s batch `Promotion` name lookup — `commands/promotions.ts`'s
  // own precedent (`resolvePromotionIdsForCode`) uses a plain `em.find`, not
  // `findWithDecryption`, so this mock sits directly on `em`, not the shared
  // `mockFindWithDecryption` fake store.
  em.find = jest.fn(async (entity: unknown, where: Row) => {
    if (entity === Promotion) return filterRows(seededPromotions, where)
    return []
  })
  const approvalService = opts.approvalService === undefined ? undefined : opts.approvalService
  return {
    resolve: (token: string): any => {
      if (token === 'em') return em
      if (token === 'catalogBuyerPricingService') return { resolveLinePrice }
      if (token === 'customerPurchaseApprovalService') {
        if (approvalService === undefined) throw new Error('customerPurchaseApprovalService not registered')
        return approvalService
      }
      throw new Error(`Unexpected DI token: ${token}`)
    },
    resolveLinePrice,
    em,
  } as any
}

function resetFixtures() {
  seededCarts = [makeCartFixture()]
  seededCartLines = []
  seededPriceRows = [{ id: 'price-row-1', product: 'product-1', tenantId: TENANT_ID, organizationId: ORG_ID, minQuantity: 1, maxQuantity: null }]
  seededPromotionApplications = []
  seededPromotions = []
  jest.clearAllMocks()
  mockResolveAvailability.mockImplementation(async () => ({ byItem: {} }))
}

describe('buildCartResponseEnvelope', () => {
  beforeEach(resetFixtures)

  it('throws notFound when the cart does not resolve', async () => {
    seededCarts = []
    const container = makeContainer()

    let captured: unknown
    try {
      await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  it('builds the §10.1 shape for a lineless cart, omitting optional fields', async () => {
    const container = makeContainer()
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(envelope.cart.token).toBeUndefined()
    expect(envelope.cart.lines).toEqual([])
    expect(envelope.cart.lineCount).toBe(0)
    expect(envelope.cart.itemCount).toBe(0)
    expect(envelope.cart.promotions).toEqual([])
    expect(envelope.cart.approval).toBeNull()
    expect(envelope.cart.status).toBe('active')
    expect(envelope.priceChanges).toBeUndefined()
    expect(envelope.versionBumpReason).toBeUndefined()
    expect(envelope.warnings).toBeUndefined()
  })

  it('includes the plaintext token only when supplied (POST /current creation response)', async () => {
    const container = makeContainer()
    const envelope = await buildCartResponseEnvelope({
      container,
      cartId: CART_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      token: 'plaintext-token',
    })
    expect(envelope.cart.token).toBe('plaintext-token')
  })

  // Step 3.2 — `approval` is now read LIVE through `customerPurchaseApprovalService.getApproval`
  // (never denormalized), and `qualifies` reuses the same `approvalQualifies` formula
  // `cart.lock`'s own gate check applies.
  it('reads the approval live and maps it to the §10.1 shape, including qualifies', async () => {
    seededCarts = [
      makeCartFixture({
        approvalId: 'approval-1',
        requiresApproval: true,
        currencyCode: 'USD',
        totals: { grandTotalGrossAmount: 50 },
      }),
    ]
    const getApproval = jest.fn(async () => ({
      id: 'approval-1',
      status: 'approved',
      amountGross: '100.0000',
      currencyCode: 'USD',
    }))
    const container = makeContainer({ approvalService: { getApproval } })
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(getApproval).toHaveBeenCalledWith({ scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, approvalId: 'approval-1' })
    expect(envelope.cart.approval).toEqual({
      id: 'approval-1',
      status: 'approved',
      amountGross: '100.0000',
      currencyCode: 'USD',
      qualifies: true,
    })
    expect(envelope.cart.requiresApproval).toBe(true)
  })

  it('reads qualifies as false for a pending approval, and null when the approval service is unavailable', async () => {
    seededCarts = [makeCartFixture({ approvalId: 'approval-1', requiresApproval: true })]
    const pendingService = { getApproval: jest.fn(async () => ({ id: 'approval-1', status: 'pending', amountGross: '10.0000', currencyCode: 'USD' })) }
    const pendingEnvelope = await buildCartResponseEnvelope({
      container: makeContainer({ approvalService: pendingService }),
      cartId: CART_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(pendingEnvelope.cart.approval).toMatchObject({ status: 'pending', qualifies: false })

    const unavailableEnvelope = await buildCartResponseEnvelope({
      container: makeContainer(),
      cartId: CART_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(unavailableEnvelope.cart.approval).toBeNull()
  })

  it('omits approval (null) when approvalId is unset, regardless of the approval service', async () => {
    seededCarts = [makeCartFixture({ approvalId: null })]
    const getApproval = jest.fn()
    const container = makeContainer({ approvalService: { getApproval } })
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(envelope.cart.approval).toBeNull()
    expect(getApproval).not.toHaveBeenCalled()
  })

  it('passes awaitingApprovalSince through verbatim', async () => {
    const since = new Date('2026-02-15T00:00:00.000Z')
    seededCarts = [makeCartFixture({ awaitingApprovalSince: since })]
    const container = makeContainer()
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(envelope.cart.awaitingApprovalSince).toEqual(since)
  })

  it('computes lineCount as the row count and itemCount as the summed quantity across non-deleted lines', async () => {
    seededCartLines = [
      makeLineFixture({ id: 'line-1', quantity: '2' }),
      makeLineFixture({ id: 'line-2', quantity: '3' }),
      makeLineFixture({ id: 'line-3', quantity: '1', deletedAt: new Date() }),
    ]
    const container = makeContainer()
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

    // The soft-deleted line is excluded by the query itself (`deleted_at IS NULL`) — the
    // fake store's `matchesSimpleWhere` re-implements that same filter — so only the two
    // live lines contribute to either count.
    expect(envelope.cart.lineCount).toBe(2)
    expect(envelope.cart.itemCount).toBe(5)
  })

  it('maps a resolved nextTier onto §5.4 shape, picking the taxMode side and computing a rounded saving percentage', async () => {
    seededCarts = [makeCartFixture({ taxMode: 'gross' })]
    seededCartLines = [makeLineFixture()]
    const resolveLinePrice = jest.fn(async () =>
      makeResolvedLinePrice({
        currentTier: { minQuantity: 1, maxQuantity: 9, amountNet: 10, amountGross: 12 },
        nextTier: { minQuantity: 10, maxQuantity: null, amountNet: 8, amountGross: 9.6 },
      }),
    )
    const container = makeContainer({ resolveLinePrice })
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(envelope.cart.lines[0].nextTier).toEqual({
      minQuantity: 10,
      unitAmount: 9.6,
      formatted: expect.any(String),
      saving: '20%',
    })
  })

  it('falls back to the resolved amount (not currentTier) for the saving baseline when currentTier is null', async () => {
    seededCarts = [makeCartFixture({ taxMode: 'net' })]
    seededCartLines = [makeLineFixture()]
    const resolveLinePrice = jest.fn(async () =>
      makeResolvedLinePrice({
        amountNet: 10,
        amountGross: 12,
        currentTier: null,
        nextTier: { minQuantity: 10, maxQuantity: null, amountNet: 8, amountGross: 9.6 },
      }),
    )
    const container = makeContainer({ resolveLinePrice })
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(envelope.cart.lines[0].nextTier).toMatchObject({ minQuantity: 10, unitAmount: 8, saving: '20%' })
  })

  it('maps nextTier to null when resolveLinePrice reports no higher tier', async () => {
    seededCartLines = [makeLineFixture()]
    const container = makeContainer({ resolveLinePrice: jest.fn(async () => makeResolvedLinePrice({ nextTier: null })) })
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(envelope.cart.lines[0].nextTier).toBeNull()
  })

  it('leaves nextTier null without calling resolveLinePrice when no price rows resolve for the line', async () => {
    seededPriceRows = []
    seededCartLines = [makeLineFixture()]
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())
    const container = makeContainer({ resolveLinePrice })
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(envelope.cart.lines[0].nextTier).toBeNull()
    expect(resolveLinePrice).not.toHaveBeenCalled()
  })

  it('flattens a flagged line into a top-level warning and merges it with route-supplied warnings', async () => {
    seededCartLines = [makeLineFixture({ id: 'line-1', flagState: 'product_unavailable' })]
    const container = makeContainer()
    const envelope = await buildCartResponseEnvelope({
      container,
      cartId: CART_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      warnings: [{ code: 'quantity_capped', lineId: 'line-1', message: '[internal] capped' }],
    })

    expect(envelope.warnings).toEqual([
      { code: 'product_unavailable', lineId: 'line-1', message: expect.any(String) },
      { code: 'quantity_capped', lineId: 'line-1', message: '[internal] capped' },
    ])
  })

  // Step 8.5 (QA F13) — a flagged line's warning message must be real, translated copy
  // (`lib/warningMessages.ts`'s `resolveCartWarningMessage`), never the raw `[internal]`
  // developer placeholder this module used to return straight to the storefront buyer.
  it('resolves a flagged line warning to real translated text with no [internal] prefix', async () => {
    seededCartLines = [makeLineFixture({ id: 'line-1', flagState: 'product_unavailable' })]
    const container = makeContainer()
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

    const warning = envelope.warnings?.find((entry) => entry.code === 'product_unavailable')
    expect(warning?.message).toBe('This line is no longer available for the buyer’s assortment scope')
    expect(warning?.message).not.toContain('[internal]')
  })

  // TC-CART-TOT-02 (§3.2 "the cart stores the returned totals verbatim. It does not round,
  // re-sum or adjust them"). `buildCartResponseEnvelope` never imports/resolves
  // `salesCalculationService` at all (confirmed by reading `cartView.ts`) — `envelope.cart.totals`
  // is `cart.totals` straight off the fetched row. Odd, deliberately non-"clean" decimals here
  // (not round numbers a recompute might coincidentally reproduce) make a silent re-rounding
  // or re-sum detectable: any recomputation of these particular inputs would not land back on
  // this exact persisted value by accident.
  it('TC-CART-TOT-02: returns Cart.totals verbatim on read, with no re-rounding or recomputation', async () => {
    const persistedTotals = {
      subtotalNetAmount: 16.3333,
      subtotalGrossAmount: 19.5999,
      discountTotalAmount: 0.0001,
      taxTotalAmount: 3.2666,
      grandTotalNetAmount: 16.3333,
      grandTotalGrossAmount: 19.5999,
    }
    seededCarts = [makeCartFixture({ totals: persistedTotals })]
    const container = makeContainer()
    const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(envelope.cart.totals).toEqual(persistedTotals)
  })

  it('includes priceChanges/versionBumpReason only when the caller supplies non-empty values', async () => {
    const container = makeContainer()
    const envelope = await buildCartResponseEnvelope({
      container,
      cartId: CART_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      priceChanges: [],
      versionBumpReason: 'repricing',
    })
    expect(envelope.priceChanges).toBeUndefined()
    expect(envelope.versionBumpReason).toBe('repricing')
  })

  describe('§5.3 availabilityState', () => {
    it('maps a resolved in_stock result onto the StorefrontAvailability-equivalent shape', async () => {
      seededCartLines = [makeLineFixture({ id: 'line-1', productId: 'product-1', variantId: null })]
      mockResolveAvailability.mockImplementation(async () => ({
        byItem: {
          'product-1:': { state: 'in_stock', availableQuantity: 10, canFulfil: true, leadTimeDays: null, releaseAt: null, isAuthoritative: true, policySourceId: null },
        },
      }))
      const container = makeContainer()
      const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

      expect(envelope.cart.lines[0].availabilityState).toEqual({
        state: 'in_stock',
        canFulfil: true,
        leadTimeDays: null,
        releaseAt: null,
      })
    })

    it('falls back to not_tracked/canFulfil true when the provider returns no entry for the line', async () => {
      seededCartLines = [makeLineFixture({ id: 'line-1', productId: 'product-1', variantId: null })]
      mockResolveAvailability.mockImplementation(async () => ({ byItem: {} }))
      const container = makeContainer()
      const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

      expect(envelope.cart.lines[0].availabilityState).toEqual({
        state: 'not_tracked',
        canFulfil: true,
        leadTimeDays: null,
        releaseAt: null,
      })
    })

    it('does not call resolveAvailability for a lineless cart', async () => {
      const container = makeContainer()
      await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
      expect(mockResolveAvailability).not.toHaveBeenCalled()
    })

    it('batches ONE resolveAvailability call per response, deduping by (productId, variantId) and summing quantity across lines sharing a pair', async () => {
      seededCartLines = [
        makeLineFixture({ id: 'line-1', productId: 'product-1', variantId: null, quantity: '2' }),
        makeLineFixture({ id: 'line-2', productId: 'product-1', variantId: null, quantity: '3', configuration: { engraving: 'A' } }),
        makeLineFixture({ id: 'line-3', productId: 'product-2', variantId: 'variant-9', quantity: '1' }),
      ]
      const container = makeContainer()
      await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

      expect(mockResolveAvailability).toHaveBeenCalledTimes(1)
      const query = mockResolveAvailability.mock.calls[0][0] as { items: Row[] }
      expect(query.items).toEqual([
        { catalogProductId: 'product-1', catalogVariantId: null, quantity: 5 },
        { catalogProductId: 'product-2', catalogVariantId: 'variant-9', quantity: 1 },
      ])
    })

    it('passes the cart\'s storeId and salesChannelId through to the availability query', async () => {
      seededCarts = [makeCartFixture({ storeId: 'store-1', salesChannelId: 'channel-1' })]
      seededCartLines = [makeLineFixture()]
      const container = makeContainer()
      await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

      const query = mockResolveAvailability.mock.calls[0][0] as Row
      expect(query.storeId).toBe('store-1')
      expect(query.channelId).toBe('channel-1')
      expect(query.tenantId).toBe(TENANT_ID)
      expect(query.organizationId).toBe(ORG_ID)
    })

    it('surfaces a top-level out_of_stock warning for every out-of-stock line on every read, merged with other warnings', async () => {
      seededCartLines = [
        makeLineFixture({ id: 'line-1', productId: 'product-1', variantId: null }),
        makeLineFixture({ id: 'line-2', productId: 'product-2', variantId: null }),
      ]
      mockResolveAvailability.mockImplementation(async () => ({
        byItem: {
          'product-1:': { state: 'out_of_stock', availableQuantity: 0, canFulfil: false, leadTimeDays: null, releaseAt: null, isAuthoritative: true, policySourceId: null },
          'product-2:': { state: 'in_stock', availableQuantity: 5, canFulfil: true, leadTimeDays: null, releaseAt: null, isAuthoritative: true, policySourceId: null },
        },
      }))
      const container = makeContainer()
      const envelope = await buildCartResponseEnvelope({
        container,
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        warnings: [{ code: 'quantity_capped', lineId: 'line-2', message: '[internal] capped' }],
      })

      expect(envelope.warnings).toEqual([
        { code: 'out_of_stock', lineId: 'line-1', message: expect.any(String) },
        { code: 'quantity_capped', lineId: 'line-2', message: '[internal] capped' },
      ])
    })
  })

  // QA F10 — §10.1's `promotions: AppliedPromotionView[]` was hardcoded to `[]` with no
  // real mapping from `CartPromotionApplication` at all. See `cartView.ts`'s
  // `buildAppliedPromotionViews` for the field shape and the deleted-promotion judgment call.
  describe('§10.1 promotions (QA F10)', () => {
    it('maps an order-scope code application and a line-scope automatic application, resolving promotion names from Promotion rows', async () => {
      seededPromotionApplications = [
        makePromotionApplicationFixture({
          id: 'app-order',
          promotionId: 'promotion-order',
          code: 'SUMMER10',
          codeId: 'code-1',
          scope: 'order',
          cartLineId: null,
          amountNet: '-14.8000',
          amountGross: '-17.7600',
        }),
        makePromotionApplicationFixture({
          id: 'app-line',
          promotionId: 'promotion-line',
          scope: 'line',
          cartLineId: 'line-1',
          amountNet: '-29.6000',
          amountGross: '-35.5200',
        }),
      ]
      seededPromotions = [
        makePromotionFixture({ id: 'promotion-order', name: 'Summer Sale' }),
        makePromotionFixture({ id: 'promotion-line', name: 'Automatic Line Discount' }),
      ]
      const container = makeContainer()
      const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

      expect(envelope.cart.promotions).toEqual([
        {
          promotionId: 'promotion-order',
          promotionName: 'Summer Sale',
          code: 'SUMMER10',
          scope: 'order',
          cartLineId: null,
          amountNet: '-14.8000',
          amountGross: '-17.7600',
        },
        {
          promotionId: 'promotion-line',
          promotionName: 'Automatic Line Discount',
          code: null,
          scope: 'line',
          cartLineId: 'line-1',
          amountNet: '-29.6000',
          amountGross: '-35.5200',
        },
      ])
    })

    it('batches ONE Promotion lookup across every distinct promotionId, never one per application row', async () => {
      seededPromotionApplications = [
        makePromotionApplicationFixture({ id: 'app-1', promotionId: 'promotion-1', scope: 'line', cartLineId: 'line-1' }),
        makePromotionApplicationFixture({ id: 'app-2', promotionId: 'promotion-1', scope: 'line', cartLineId: 'line-2' }),
        makePromotionApplicationFixture({ id: 'app-3', promotionId: 'promotion-2', scope: 'line', cartLineId: 'line-3' }),
      ]
      seededPromotions = [makePromotionFixture({ id: 'promotion-1' }), makePromotionFixture({ id: 'promotion-2', name: 'Promotion Two' })]
      const container = makeContainer()
      await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

      expect(container.em.find).toHaveBeenCalledTimes(1)
      const [, where] = container.em.find.mock.calls[0]
      expect(where.id.$in).toEqual(expect.arrayContaining(['promotion-1', 'promotion-2']))
    })

    it('omits an application row whose Promotion was deleted, without throwing', async () => {
      seededPromotionApplications = [makePromotionApplicationFixture({ id: 'app-gone', promotionId: 'promotion-gone' })]
      seededPromotions = []
      const container = makeContainer()
      const envelope = await buildCartResponseEnvelope({ container, cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID })

      expect(envelope.cart.promotions).toEqual([])
    })
  })
})
