jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../events', () => ({
  emitCartEvent: jest.fn(async () => undefined),
}))

import { CatalogProduct, CatalogProductPrice, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { Cart, CartLine } from '../../data/entities'
import { emitCartEvent as mockedEmitCartEvent } from '../../events'

const emitCartEventMock = mockedEmitCartEvent as jest.Mock

type Row = Record<string, any>

let seededCarts: Row[] = []
let seededCartLines: Row[] = []
let seededProducts: Row[] = []
let seededVariants: Row[] = []
let seededPriceRows: Row[] = []

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
  if (entity === Cart) return filterRows(seededCarts, where)
  if (entity === CartLine) return filterRows(seededCartLines, where)
  if (entity === CatalogProduct) return filterRows(seededProducts, where)
  if (entity === CatalogProductVariant) return filterRows(seededVariants, where)
  // The batched price-row filter (`buildPriceRowFilter` + a product/variant `$or`) is a
  // complex MikroORM query shape this fake store does not re-implement — catalog's own
  // suites already cover `buildPriceRowFilter`/`selectBestPrice`. This test only asserts
  // cart's own orchestration (did it fetch, did it feed rows to the pricing SERVICE, which
  // is itself mocked below), so every call for this entity returns the full seeded set.
  if (entity === CatalogProductPrice) return [...seededPriceRows]
  return []
})

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Row) => {
  if (entity === Cart) return filterRows(seededCarts, where)[0] ?? null
  if (entity === CartLine) return filterRows(seededCartLines, where)[0] ?? null
  if (entity === CatalogProduct) return filterRows(seededProducts, where)[0] ?? null
  if (entity === CatalogProductVariant) return filterRows(seededVariants, where)[0] ?? null
  if (entity === CatalogProductPrice) return filterRows(seededPriceRows, where)[0] ?? null
  return null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [unknown, unknown, Row])),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Row])),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type {
  CartLinesAddInput,
  CartLinesAddOutcome,
  CartLinesBulkAddInput,
  CartLinesBulkAddResult,
  CartLinesRemoveInput,
  CartLinesRemoveResult,
  CartLinesUpdateInput,
  CartLinesUpdateOutcome,
} from '../lines'
import '../lines'
// Step 8.2 (QA F12) — registers `cart.reprice`/`cart.create`/`cart.get` into the SAME shared
// `commandRegistry` `getHandler` reads from, so the undo-restores-totals tests below can
// dispatch a REAL `cart.reprice` through a test-local `commandBus` stub instead of a
// fully-faked one — see the "undo ... restores Cart.totals" tests.
import '../cart'

const TENANT_ID = 'tenant-cart-1'
const ORG_ID = 'org-cart-1'
const CART_ID = 'cart-1'

let lineIdCounter = 0

function makeCartFixture(overrides: Row = {}): Row {
  return {
    id: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'basket',
    status: 'active',
    channel: 'pos',
    storeId: null,
    salesChannelId: null,
    currencyCode: 'USD',
    customerId: null,
    customerIds: [],
    customerGroupIds: [],
    priceKindId: null,
    ...overrides,
  }
}

function makeProductFixture(overrides: Row = {}): Row {
  return {
    id: 'product-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    title: 'Widget',
    sku: 'WIDGET-1',
    minOrderQty: null,
    maxOrderQty: null,
    orderQtyIncrement: null,
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
    currentTier: { minQuantity: 1, maxQuantity: null, amountNet: 10, amountGross: 12 },
    nextTier: null,
    tiers: [],
    ...overrides,
  }
}

function makeLineTotalsFixture(quantity: number) {
  return {
    line: { kind: 'product', quantity, currencyCode: 'USD' },
    netAmount: quantity * 10,
    grossAmount: quantity * 12,
    taxAmount: quantity * 2,
    discountAmount: 0,
    adjustments: [],
  }
}

function makeEm() {
  const em: any = {
    fork: jest.fn(),
    // `deletedAt` defaults to `null` here the same way a real entity's nullable column
    // reads back as `null` once persisted — the merge-by-quantity lookup filters on it.
    create: jest.fn((_ctor: unknown, data: Row) => ({ id: `generated-line-${++lineIdCounter}`, deletedAt: null, ...data })),
    persist: jest.fn((row: Row) => {
      seededCartLines.push(row)
    }),
    flush: jest.fn(async () => undefined),
    find: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CartLine) return filterRows(seededCartLines, where)
      return []
    }),
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CartLine) return filterRows(seededCartLines, where)[0] ?? null
      return null
    }),
    // `cart.lines.add`/`.bulkAdd` wrap their merge-decide-write in
    // `withAtomicFlush({ transaction: true })` plus a `pg_advisory_xact_lock` via
    // `em.execute` (concurrency fix, review finding) — stub the transaction/raw-SQL surface
    // `withAtomicFlush` drives so this fake EM still satisfies it.
    execute: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeDataEngine() {
  return { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn(async () => {}) }
}

// Step 8.2 (QA F12) — every line-mutation command now also runs `buildPromotionsEffectsPhase`
// + `buildRecomputeCartTotalsPhase` after its own mutation, so this harness's container must
// resolve `promotionsService` and support `.register(...)` (the `auth` DI token those phases
// need) even for tests that don't care about promotions themselves. `commandBus` backs the
// `.add`/`.remove`/`.bulkAdd` undo handlers' `cart.reprice` dispatch — a plain stub by
// default; a test that cares about undo-restores-totals overrides it with one that actually
// delegates to the registered `cart.reprice` handler (see that describe block).
function makeCtx(opts: {
  em: unknown
  dataEngine?: unknown
  catalogBuyerPricingService?: unknown
  salesCalculationService?: unknown
  policyResolutionService?: unknown
  catalogScopedProductService?: unknown
  promotionsService?: unknown
  commandBus?: unknown
}): CommandRuntimeContext {
  return {
    container: {
      register: jest.fn(),
      resolve: (token: string): any => {
        if (token === 'em') return opts.em
        if (token === 'dataEngine') return opts.dataEngine ?? makeDataEngine()
        if (token === 'catalogBuyerPricingService') {
          return opts.catalogBuyerPricingService ?? { resolveLinePrice: jest.fn(async () => makeResolvedLinePrice()) }
        }
        if (token === 'salesCalculationService') {
          return (
            opts.salesCalculationService ?? {
              calculateLine: jest.fn(async ({ line }: any) => makeLineTotalsFixture(line.quantity)),
              calculateDocumentTotals: jest.fn(async ({ lines, adjustments }: any) => makeDocumentTotalsFixture(lines, adjustments)),
            }
          )
        }
        if (token === 'promotionsService') {
          return (
            opts.promotionsService ?? {
              evaluate: jest.fn(async () => ({ appliedPromotions: [] })),
              extendReservation: jest.fn(async () => undefined),
              reserveCode: jest.fn(),
              releaseCode: jest.fn(),
            }
          )
        }
        if (token === 'commandBus') {
          return opts.commandBus ?? { execute: jest.fn(async () => ({ result: { cart: {}, priceChanges: [] }, logEntry: null })) }
        }
        if (token === 'policyResolutionService') {
          if (opts.policyResolutionService) return opts.policyResolutionService
          throw new Error('policyResolutionService not registered (availability disabled)')
        }
        if (token === 'catalogScopedProductService') {
          if (opts.catalogScopedProductService) return opts.catalogScopedProductService
          throw new Error('catalogScopedProductService not registered')
        }
        throw new Error(`Unexpected DI token: ${token}`)
      },
    } as any,
    auth: null,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

/** Default `calculateDocumentTotals` fixture — sums each line's net/gross/discount so a
 * non-zero add and a zeroed-out "last line removed" case both read back correctly without
 * every test having to supply its own `salesCalculationService` override. */
function makeDocumentTotalsFixture(lines: Array<Record<string, any>>, adjustments: Array<Record<string, any>> = []) {
  const subtotalNetAmount = lines.reduce((sum, line) => sum + (line.unitPriceNet ?? 0) * line.quantity, 0)
  const subtotalGrossAmount = lines.reduce((sum, line) => sum + (line.unitPriceGross ?? 0) * line.quantity, 0)
  const lineDiscountTotal = lines.reduce((sum, line) => sum + (line.discountAmount ?? 0), 0)
  const orderDiscountTotal = adjustments.reduce((sum, adjustment) => sum + Math.abs(adjustment.amountNet ?? 0), 0)
  const discountTotalAmount = lineDiscountTotal + orderDiscountTotal
  return {
    totals: {
      subtotalNetAmount,
      subtotalGrossAmount,
      discountTotalAmount,
      taxTotalAmount: subtotalGrossAmount - subtotalNetAmount,
      grandTotalNetAmount: subtotalNetAmount - discountTotalAmount,
      grandTotalGrossAmount: subtotalGrossAmount - discountTotalAmount,
    },
  }
}

function getHandler<I, R>(id: string): CommandHandler<I, R> {
  const handler = commandRegistry.get<I, R>(id)
  if (!handler) throw new Error(`command ${id} not registered`)
  return handler
}

function resetFixtures() {
  seededCarts = [makeCartFixture()]
  seededCartLines = []
  seededProducts = [makeProductFixture()]
  seededVariants = []
  seededPriceRows = [{ id: 'price-row-1', tenantId: TENANT_ID, organizationId: ORG_ID, minQuantity: 1, maxQuantity: null }]
  lineIdCounter = 0
  jest.clearAllMocks()
}

describe('cart.lines.add', () => {
  beforeEach(resetFixtures)

  it('creates a new line with a correct price snapshot', async () => {
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())
    const ctx = makeCtx({ em, catalogBuyerPricingService: { resolveLinePrice } })

    const result = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 2, addedByActorType: 'rep' },
      ctx,
    )

    expect(result.status).toBe('added')
    if (result.status !== 'added') throw new Error('expected added')
    expect(result.line.quantity).toBe('2')
    expect(result.line.unitPriceNet).toBe('10')
    expect(result.line.unitPriceGross).toBe('12')
    expect(result.line.priceRowId).toBe('price-row-1')
    expect(result.line.origin).toBe('customer')
    expect(result.line.name).toBe('Widget')
    expect(seededCartLines).toHaveLength(1)
    expect(resolveLinePrice).toHaveBeenCalledTimes(1)
  })

  // Step 5.5 — trigger-isolation gate (§14/§15): `cart.lines.add` is NOT one of the §5.2
  // re-price triggers (only `.update`'s tier-crossing path, trigger 1, and `cart.get`'s
  // trigger 2-4 detection are) — confirmed by reading `execute` above, which never emits
  // `cart.price.changed` on either the fresh-insert or the merge-by-quantity branch.
  it('never fires cart.price.changed — adding a line is not one of the §5.2 re-price triggers', async () => {
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 2, addedByActorType: 'rep' },
      ctx,
    )

    expect(result.status).toBe('added')
    expect(emitCartEventMock.mock.calls.some(([eventId]) => eventId === 'cart.price.changed')).toBe(false)
  })

  it('sums a second add of the identical product/variant/configuration into the existing line and re-prices at the new total quantity', async () => {
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())
    const em1 = makeEm()
    await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 2, addedByActorType: 'rep' },
      makeCtx({ em: em1, catalogBuyerPricingService: { resolveLinePrice } }),
    )
    expect(seededCartLines).toHaveLength(1)

    const em2 = makeEm()
    const result = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 3, addedByActorType: 'rep' },
      makeCtx({ em: em2, catalogBuyerPricingService: { resolveLinePrice } }),
    )

    expect(result.status).toBe('merged')
    if (result.status !== 'merged') throw new Error('expected merged')
    expect(result.line.quantity).toBe('5')
    expect(seededCartLines).toHaveLength(1)
    const lastCall = resolveLinePrice.mock.calls[resolveLinePrice.mock.calls.length - 1]
    expect(lastCall[2].quantity).toBe(5)
  })

  it('undoing a merge restores the line to its pre-merge quantity, never deletes it', async () => {
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())

    const em1 = makeEm()
    await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 2, addedByActorType: 'rep' },
      makeCtx({ em: em1, catalogBuyerPricingService: { resolveLinePrice } }),
    )
    expect(seededCartLines).toHaveLength(1)
    expect(seededCartLines[0].quantity).toBe('2')

    const em2 = makeEm()
    const ctx2 = makeCtx({ em: em2, catalogBuyerPricingService: { resolveLinePrice } })
    const mergeResult = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 3, addedByActorType: 'rep' },
      ctx2,
    )
    expect(mergeResult.status).toBe('merged')
    expect(seededCartLines[0].quantity).toBe('5')

    const logEntry = await handler.buildLog!({ input: {} as any, result: mergeResult, ctx: ctx2, snapshots: {} })
    await handler.undo!({
      input: {} as any,
      ctx: ctx2,
      logEntry: { ...(logEntry as any), commandPayload: (logEntry as any).payload } as unknown as CommandUndoLogEntry,
    })

    // The real bug this guards: a merge's "before" snapshot must survive into the
    // undo payload. Losing it makes undo fall through to the "no before" branch, which
    // deletes the whole line (including the 2 units the buyer already had) instead of
    // restoring the pre-merge quantity.
    expect(seededCartLines).toHaveLength(1)
    expect(seededCartLines[0].deletedAt).toBeNull()
    expect(seededCartLines[0].quantity).toBe('2')
  })

  it('is rejected by the quantity rule below the minimum, with the minimum as nearestValid', async () => {
    seededProducts = [makeProductFixture({ minOrderQty: 5 })]
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const result = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 2 },
      makeCtx({ em }),
    )
    expect(result).toEqual({ status: 'rejected', reason: 'quantity_below_minimum', nearestValid: 5 })
    expect(seededCartLines).toHaveLength(0)
  })

  it('is accepted but clamped to the maximum with a warning, never rejected', async () => {
    seededProducts = [makeProductFixture({ maxOrderQty: 10 })]
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const result = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 25, addedByActorType: 'rep' },
      makeCtx({ em }),
    )
    expect(result.status).toBe('added')
    if (result.status !== 'added') throw new Error('expected added')
    expect(result.line.quantity).toBe('10')
    expect(result.warnings).toEqual(['quantity_capped'])
  })

  it('is rejected by a non-increment quantity, offering the nearest valid quantity', async () => {
    seededProducts = [makeProductFixture({ orderQtyIncrement: 5 })]
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const result = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 7 },
      makeCtx({ em }),
    )
    expect(result).toEqual({ status: 'rejected', reason: 'quantity_invalid_increment', nearestValid: 5 })
    expect(seededCartLines).toHaveLength(0)
  })

  it('is rejected by visibility with a product_unavailable warning rather than a thrown error, and creates no line', async () => {
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const loadScopedProducts = jest.fn(async () => new Map([['product-1', { id: 'product-1', categoryIds: [], tagIds: [], isActive: true }]]))
    const ctx = makeCtx({ em, catalogScopedProductService: { loadScopedProducts } })

    let threw = false
    let result: CartLinesAddOutcome | undefined
    try {
      result = await handler.execute(
        {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          cartId: CART_ID,
          productId: 'product-1',
          quantity: 1,
          // A restricted scope that never matches — any non-null, non-matching
          // AssortmentScope[] is enough since `matchesScope` is exercised by
          // Step 4.4's own suite, not re-tested here.
          assortmentScope: [{ categoryIds: ['does-not-exist'] }] as any,
        },
        ctx,
      )
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(result).toEqual({ status: 'rejected', reason: 'product_unavailable' })
    expect(seededCartLines).toHaveLength(0)
  })

  // TC-CART-R1-10: `cart.line.visibility_rejected` fires once per request with the correct
  // `rejectedCount`/`triggeredBy`, from the §6a.1c enforcement point this command owns.
  it('emits cart.line.visibility_rejected once with rejectedCount 1 and triggeredBy lines.add', async () => {
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const loadScopedProducts = jest.fn(async () => new Map([['product-1', { id: 'product-1', categoryIds: [], tagIds: [], isActive: true }]]))
    const ctx = makeCtx({ em, catalogScopedProductService: { loadScopedProducts } })

    await handler.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        cartId: CART_ID,
        productId: 'product-1',
        quantity: 1,
        assortmentScope: [{ categoryIds: ['does-not-exist'] }] as any,
      },
      ctx,
    )

    const visibilityRejectedCalls = emitCartEventMock.mock.calls.filter(([eventId]) => eventId === 'cart.line.visibility_rejected')
    expect(visibilityRejectedCalls).toHaveLength(1)
    expect(visibilityRejectedCalls[0][1]).toMatchObject({ cartId: CART_ID, rejectedCount: 1, triggeredBy: 'lines.add' })
  })

  // TC-CART-R1-06: a non-storefront ("pos"/"pay_link"/"agent"/"api") cart created via the
  // authenticated path (§6a.4) runs NO assortment check at all — not "runs the check and it
  // happens to pass". Mocking `catalogScopedProductService` to reject the product and never
  // passing `assortmentScope` on the call proves the check is skipped, not merely satisfied:
  // `loadScopedProducts` is never invoked, the line is added, and no `visibility_rejected`
  // event fires, regardless of what the storefront assortment status would have said.
  it('skips the assortment check entirely for a non-storefront cart with no resolved scope (§6a.1b/§6a.4)', async () => {
    seededCarts = [makeCartFixture({ channel: 'agent' })]
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const loadScopedProducts = jest.fn(async () => new Map())
    const ctx = makeCtx({ em, catalogScopedProductService: { loadScopedProducts } })

    const result = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 1, addedByActorType: 'ai_agent' },
      ctx,
    )

    expect(result.status).toBe('added')
    expect(loadScopedProducts).not.toHaveBeenCalled()
    expect(emitCartEventMock.mock.calls.some(([eventId]) => eventId === 'cart.line.visibility_rejected')).toBe(false)
  })
})

describe('cart.lines.update', () => {
  beforeEach(resetFixtures)

  async function seedLine(overrides: Row = {}): Promise<Row> {
    const line = {
      id: 'line-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: CART_ID,
      lineNumber: 1,
      productId: 'product-1',
      variantId: null,
      sku: 'WIDGET-1',
      name: 'Widget',
      optionValues: null,
      quantity: '5',
      unitPriceNet: '10',
      unitPriceGross: '12',
      taxRate: '20',
      priceKindId: null,
      priceRowId: 'price-row-1',
      priceTierMinQuantity: 1,
      pricedAt: new Date('2026-01-01T00:00:00.000Z'),
      lineTotals: makeLineTotalsFixture(5),
      discountTotalNet: null,
      promotionId: null,
      origin: 'customer',
      configuration: null,
      addedByActorType: 'buyer',
      addedByActorId: null,
      metadata: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      ...overrides,
    }
    seededCartLines = [line]
    return line
  }

  it('rejects an update on a promotion-origin line with a thrown conflict', async () => {
    await seedLine({ origin: 'promotion' })
    const handler = getHandler<CartLinesUpdateInput, CartLinesUpdateOutcome>('cart.lines.update')
    const em = makeEm()

    let captured: unknown
    try {
      await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1', quantity: 8 }, makeCtx({ em }))
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
  })

  it('re-prices when the new quantity crosses the current price row tier boundary, discloses a tier_change priceChange, and stamps cart.lastPriceChangeAt', async () => {
    await seedLine()
    seededPriceRows = [{ id: 'price-row-1', tenantId: TENANT_ID, organizationId: ORG_ID, minQuantity: 1, maxQuantity: 9 }]
    const handler = getHandler<CartLinesUpdateInput, CartLinesUpdateOutcome>('cart.lines.update')
    const em = makeEm()
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice({ priceRow: { id: 'price-row-2' }, amountNet: 8, amountGross: 9.6, currentTier: { minQuantity: 10, maxQuantity: null, amountNet: 8, amountGross: 9.6 } }))
    const ctx = makeCtx({ em, catalogBuyerPricingService: { resolveLinePrice } })

    const result = await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1', quantity: 15 }, ctx)

    expect(result.status).toBe('updated')
    if (result.status !== 'updated') throw new Error('expected updated')
    expect(result.line.quantity).toBe('15')
    expect(result.line.priceRowId).toBe('price-row-2')
    expect(result.line.priceTierMinQuantity).toBe(10)
    expect(resolveLinePrice).toHaveBeenCalledTimes(1)
    expect(result.priceChanges).toEqual([
      {
        lineId: 'line-1',
        productId: 'product-1',
        oldUnitPriceNet: '10',
        newUnitPriceNet: '8',
        oldUnitPriceGross: '12',
        newUnitPriceGross: '9.6',
        reason: 'tier_change',
      },
    ])
    expect(seededCarts[0].lastPriceChangeAt).toBeInstanceOf(Date)
    const priceChangedCalls = emitCartEventMock.mock.calls.filter(([eventId]) => eventId === 'cart.price.changed')
    expect(priceChangedCalls).toHaveLength(1)
    expect(priceChangedCalls[0][1]).toMatchObject({ cartId: CART_ID, changes: result.priceChanges })
  })

  it('does not call the pricing service for a same-tier quantity change, and does not disclose a priceChange or stamp lastPriceChangeAt', async () => {
    await seedLine()
    seededPriceRows = [{ id: 'price-row-1', tenantId: TENANT_ID, organizationId: ORG_ID, minQuantity: 1, maxQuantity: 9 }]
    const handler = getHandler<CartLinesUpdateInput, CartLinesUpdateOutcome>('cart.lines.update')
    const em = makeEm()
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())
    const ctx = makeCtx({ em, catalogBuyerPricingService: { resolveLinePrice } })

    const result = await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1', quantity: 6 }, ctx)

    expect(result.status).toBe('updated')
    if (result.status !== 'updated') throw new Error('expected updated')
    expect(result.line.quantity).toBe('6')
    expect(result.line.priceRowId).toBe('price-row-1')
    expect(resolveLinePrice).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalledWith(expect.anything(), CatalogProductPrice, expect.anything())
    expect(result.priceChanges).toEqual([])
    expect(seededCarts[0].lastPriceChangeAt).toBeUndefined()
    expect(emitCartEventMock.mock.calls.some(([eventId]) => eventId === 'cart.price.changed')).toBe(false)
  })

  // TC-CART-R1-05/R1-10: a line whose product has since become restricted is rejected, left
  // untouched (not deleted, quantity unchanged), and emits `cart.line.visibility_rejected`
  // once with `triggeredBy: 'lines.update'`.
  it('rejects an update when the product has since become restricted, leaves the line untouched, and emits visibility_rejected', async () => {
    await seedLine({ quantity: '5' })
    const handler = getHandler<CartLinesUpdateInput, CartLinesUpdateOutcome>('cart.lines.update')
    const em = makeEm()
    const loadScopedProducts = jest.fn(async () => new Map([['product-1', { id: 'product-1', categoryIds: [], tagIds: [], isActive: true }]]))
    const ctx = makeCtx({ em, catalogScopedProductService: { loadScopedProducts } })

    const result = await handler.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        cartId: CART_ID,
        lineId: 'line-1',
        quantity: 8,
        assortmentScope: [{ categoryIds: ['does-not-exist'] }] as any,
      },
      ctx,
    )

    expect(result).toEqual({ status: 'rejected', reason: 'product_unavailable' })
    expect(seededCartLines[0].deletedAt).toBeNull()
    expect(seededCartLines[0].quantity).toBe('5')

    const visibilityRejectedCalls = emitCartEventMock.mock.calls.filter(([eventId]) => eventId === 'cart.line.visibility_rejected')
    expect(visibilityRejectedCalls).toHaveLength(1)
    expect(visibilityRejectedCalls[0][1]).toMatchObject({ cartId: CART_ID, rejectedCount: 1, triggeredBy: 'lines.update' })
  })
})

describe('cart.lines.remove', () => {
  beforeEach(resetFixtures)

  it('soft-deletes the line and is undoable via extractUndoPayload', async () => {
    seededCartLines = [{
      id: 'line-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: CART_ID,
      lineNumber: 1,
      productId: 'product-1',
      variantId: null,
      sku: null,
      name: 'Widget',
      optionValues: null,
      quantity: '1',
      unitPriceNet: '10',
      unitPriceGross: '12',
      taxRate: '20',
      priceKindId: null,
      priceRowId: 'price-row-1',
      priceTierMinQuantity: 1,
      pricedAt: new Date(),
      lineTotals: makeLineTotalsFixture(1),
      discountTotalNet: null,
      promotionId: null,
      origin: 'customer',
      configuration: null,
      addedByActorType: 'buyer',
      addedByActorId: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }]
    const handler = getHandler<CartLinesRemoveInput, CartLinesRemoveResult>('cart.lines.remove')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1' }, ctx)
    expect(result.removed).toBe(true)
    expect(seededCartLines[0].deletedAt).not.toBeNull()

    const logEntry = await handler.buildLog!({ input: {} as any, result, ctx, snapshots: {} })
    expect(handler.undo).toBeDefined()
    await handler.undo!({
      input: {} as any,
      ctx,
      logEntry: { ...(logEntry as any), commandPayload: (logEntry as any).payload } as unknown as CommandUndoLogEntry,
    })
    expect(seededCartLines[0].deletedAt).toBeNull()
  })

  // Step 5.5 — trigger-isolation gate (§14/§15): removing a line is not one of the §5.2
  // re-price triggers either — `removeLineCommand.execute` never emits `cart.price.changed`.
  it('never fires cart.price.changed — removing a line is not one of the §5.2 re-price triggers', async () => {
    seededCartLines = [{
      id: 'line-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: CART_ID,
      lineNumber: 1,
      productId: 'product-1',
      variantId: null,
      sku: null,
      name: 'Widget',
      optionValues: null,
      quantity: '1',
      unitPriceNet: '10',
      unitPriceGross: '12',
      taxRate: '20',
      priceKindId: null,
      priceRowId: 'price-row-1',
      priceTierMinQuantity: 1,
      pricedAt: new Date(),
      lineTotals: makeLineTotalsFixture(1),
      discountTotalNet: null,
      promotionId: null,
      origin: 'customer',
      configuration: null,
      addedByActorType: 'buyer',
      addedByActorId: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }]
    const handler = getHandler<CartLinesRemoveInput, CartLinesRemoveResult>('cart.lines.remove')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1' }, ctx)

    expect(result.removed).toBe(true)
    expect(emitCartEventMock.mock.calls.some(([eventId]) => eventId === 'cart.price.changed')).toBe(false)
  })
})

describe('cart.lines.bulkAdd', () => {
  beforeEach(resetFixtures)

  it('partially succeeds with per-entry warnings on a mix of valid and invalid entries', async () => {
    seededProducts = [makeProductFixture({ minOrderQty: 3 })]
    const handler = getHandler<CartLinesBulkAddInput, CartLinesBulkAddResult>('cart.lines.bulkAdd')
    const em = makeEm()
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())
    const ctx = makeCtx({ em, catalogBuyerPricingService: { resolveLinePrice } })

    const result = await handler.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        cartId: CART_ID,
        addedByActorType: 'rep',
        lines: [
          { productId: 'product-1', quantity: 5 },
          { productId: 'product-1', quantity: 1 },
          { productId: 'does-not-exist', quantity: 2 },
        ],
      },
      ctx,
    )

    expect(result.addedCount).toBe(1)
    expect(result.rejectedCount).toBe(2)
    expect(result.results[0]).toMatchObject({ index: 0, status: 'added' })
    expect(result.results[1]).toMatchObject({ index: 1, status: 'rejected', reason: 'quantity_below_minimum', nearestValid: 3 })
    expect(result.results[2]).toMatchObject({ index: 2, status: 'rejected', reason: 'product_unavailable' })
    expect(seededCartLines).toHaveLength(1)
  })

  it('rejects the whole call outright at more than 100 entries, without touching the cart', async () => {
    const handler = getHandler<CartLinesBulkAddInput, CartLinesBulkAddResult>('cart.lines.bulkAdd')
    const em = makeEm()
    const ctx = makeCtx({ em })
    const lines = Array.from({ length: 101 }, () => ({ productId: 'product-1', quantity: 1 }))

    let captured: unknown
    try {
      await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, addedByActorType: 'rep', lines }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(400)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(em.fork).not.toHaveBeenCalled()
  })

  // TC-CART-R1-04/R1-10: mixing a visible and a scope-restricted product in one batch adds
  // the visible one, reports the restricted one per-line (never a whole-batch failure), and
  // emits `cart.line.visibility_rejected` ONCE for the request with the correct count — not
  // once per rejected entry, and not counting the unrelated quantity-rule rejection below.
  it('adds the visible entry, rejects the restricted one by visibility, and emits one visibility_rejected event with rejectedCount 1', async () => {
    seededProducts = [
      makeProductFixture({ id: 'product-1' }),
      makeProductFixture({ id: 'product-2', sku: 'WIDGET-2', minOrderQty: 10 }),
      makeProductFixture({ id: 'product-3' }),
    ]
    const handler = getHandler<CartLinesBulkAddInput, CartLinesBulkAddResult>('cart.lines.bulkAdd')
    const em = makeEm()
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())
    const loadScopedProducts = jest.fn(async () =>
      new Map([
        ['product-1', { id: 'product-1', categoryIds: ['cat-a'], tagIds: [], isActive: true }],
        ['product-3', { id: 'product-3', categoryIds: ['cat-b'], tagIds: [], isActive: true }],
      ]),
    )
    const ctx = makeCtx({ em, catalogBuyerPricingService: { resolveLinePrice }, catalogScopedProductService: { loadScopedProducts } })

    const result = await handler.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        cartId: CART_ID,
        addedByActorType: 'rep',
        assortmentScope: [{ categoryIds: ['cat-a'] }] as any,
        lines: [
          { productId: 'product-1', quantity: 1 },
          { productId: 'product-2', quantity: 1 }, // rejected by the UNRELATED quantity rule, not visibility
          { productId: 'product-3', quantity: 1 }, // rejected by visibility (outside cat-a)
        ],
      },
      ctx,
    )

    expect(result.addedCount).toBe(1)
    expect(result.rejectedCount).toBe(2)
    expect(result.results[0]).toMatchObject({ index: 0, status: 'added' })
    expect(result.results[1]).toMatchObject({ index: 1, status: 'rejected', reason: 'quantity_below_minimum' })
    expect(result.results[2]).toMatchObject({ index: 2, status: 'rejected', reason: 'product_unavailable' })

    const visibilityRejectedCalls = emitCartEventMock.mock.calls.filter(([eventId]) => eventId === 'cart.line.visibility_rejected')
    expect(visibilityRejectedCalls).toHaveLength(1)
    expect(visibilityRejectedCalls[0][1]).toMatchObject({ cartId: CART_ID, rejectedCount: 1, triggeredBy: 'lines.bulkAdd' })
  })

  it('emits no visibility_rejected event when nothing was rejected for visibility', async () => {
    const handler = getHandler<CartLinesBulkAddInput, CartLinesBulkAddResult>('cart.lines.bulkAdd')
    const em = makeEm()
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())
    const ctx = makeCtx({ em, catalogBuyerPricingService: { resolveLinePrice } })

    await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, addedByActorType: 'rep', lines: [{ productId: 'product-1', quantity: 1 }] },
      ctx,
    )

    expect(emitCartEventMock.mock.calls.some(([eventId]) => eventId === 'cart.line.visibility_rejected')).toBe(false)
  })
})

// Step 7.5 — §9: "A locked cart that a client tries to mutate returns 423 Locked with the
// checkout session id, not a generic error." `loadMutableCart`'s own `assertCartNotLocked`
// call now runs for EVERY caller (`requireActive: true` or `false`), so `.add`/`.update`/
// `.bulkAdd` get this automatically and `.remove` gets it too per this step's own documented
// judgment call (see `loadMutableCart`'s and `.remove`'s own comments in `commands/lines.ts`).
describe('cart lock-awareness (Step 7.5)', () => {
  beforeEach(resetFixtures)

  function lockCart(): void {
    seededCarts[0] = { ...seededCarts[0], status: 'locked', checkoutSessionId: 'checkout-session-1' }
  }

  it('cart.lines.add returns 423 cart_locked with the checkoutSessionId, not the generic 404', async () => {
    lockCart()
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 1, addedByActorType: 'rep' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
    expect((captured as { body: Record<string, unknown> }).body).toMatchObject({
      code: 'cart_locked',
      checkoutSessionId: 'checkout-session-1',
    })
  })

  it('cart.lines.update returns 423 cart_locked with the checkoutSessionId, not the generic 404', async () => {
    lockCart()
    seededCartLines = [{
      id: 'line-1', tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineNumber: 1,
      productId: 'product-1', variantId: null, sku: null, name: 'Widget', optionValues: null,
      quantity: '5', unitPriceNet: '10', unitPriceGross: '12', taxRate: '20', priceKindId: null,
      priceRowId: 'price-row-1', priceTierMinQuantity: 1, pricedAt: new Date(),
      lineTotals: makeLineTotalsFixture(5), discountTotalNet: null, promotionId: null,
      origin: 'customer', configuration: null, addedByActorType: 'buyer', addedByActorId: null,
      metadata: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    }]
    const handler = getHandler<CartLinesUpdateInput, CartLinesUpdateOutcome>('cart.lines.update')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1', quantity: 8 }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
    expect((captured as { body: Record<string, unknown> }).body).toMatchObject({
      code: 'cart_locked',
      checkoutSessionId: 'checkout-session-1',
    })
  })

  it('cart.lines.bulkAdd returns 423 cart_locked with the checkoutSessionId, not the generic 404', async () => {
    lockCart()
    const handler = getHandler<CartLinesBulkAddInput, CartLinesBulkAddResult>('cart.lines.bulkAdd')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, addedByActorType: 'rep', lines: [{ productId: 'product-1', quantity: 1 }] },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
    expect((captured as { body: Record<string, unknown> }).body).toMatchObject({
      code: 'cart_locked',
      checkoutSessionId: 'checkout-session-1',
    })
  })

  // Step 7.5's own judgment call: `.remove` now ALSO respects a lock specifically, even
  // though it stays permissive (`requireActive: false`) for every OTHER non-active status.
  it('cart.lines.remove ALSO returns 423 cart_locked (the lock-specific carve-out this step adds), not a silent success', async () => {
    lockCart()
    seededCartLines = [{
      id: 'line-1', tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineNumber: 1,
      productId: 'product-1', variantId: null, sku: null, name: 'Widget', optionValues: null,
      quantity: '1', unitPriceNet: '10', unitPriceGross: '12', taxRate: '20', priceKindId: null,
      priceRowId: 'price-row-1', priceTierMinQuantity: 1, pricedAt: new Date(),
      lineTotals: makeLineTotalsFixture(1), discountTotalNet: null, promotionId: null,
      origin: 'customer', configuration: null, addedByActorType: 'buyer', addedByActorId: null,
      metadata: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    }]
    const handler = getHandler<CartLinesRemoveInput, CartLinesRemoveResult>('cart.lines.remove')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
    expect((captured as { body: Record<string, unknown> }).body).toMatchObject({
      code: 'cart_locked',
      checkoutSessionId: 'checkout-session-1',
    })
    expect(seededCartLines[0].deletedAt).toBeNull()
  })

  // Contrast case: `.remove` stays permissive for a non-active, non-locked status (e.g.
  // `abandoned`) — only `locked` gets the new carve-out, nothing else changed.
  it('cart.lines.remove still succeeds (no gate) against an abandoned, non-locked cart', async () => {
    seededCarts[0] = { ...seededCarts[0], status: 'abandoned' }
    seededCartLines = [{
      id: 'line-1', tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineNumber: 1,
      productId: 'product-1', variantId: null, sku: null, name: 'Widget', optionValues: null,
      quantity: '1', unitPriceNet: '10', unitPriceGross: '12', taxRate: '20', priceKindId: null,
      priceRowId: 'price-row-1', priceTierMinQuantity: 1, pricedAt: new Date(),
      lineTotals: makeLineTotalsFixture(1), discountTotalNet: null, promotionId: null,
      origin: 'customer', configuration: null, addedByActorType: 'buyer', addedByActorId: null,
      metadata: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    }]
    const handler = getHandler<CartLinesRemoveInput, CartLinesRemoveResult>('cart.lines.remove')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1' }, ctx)

    expect(result.removed).toBe(true)
    expect(seededCartLines[0].deletedAt).not.toBeNull()
  })
})

// Step 8.5 — QA finding F15: a write against a non-active (merged/expired/abandoned/
// converted) cart used to collapse into the SAME generic `404 cart not found` as a wrong-
// tenant/nonexistent lookup. `cart.mdx` documents `409` for this case and `GET /current`
// already discloses the real `status` with a `200`, so `loadMutableCart`'s `requireActive`
// branch (`commands/lines.ts`) now throws a distinguishable `409 cart_not_active` carrying
// that status instead. Only `requireActive: true` callers (`.add`/`.update`/`.bulkAdd`) are
// affected — `.remove`'s own `requireActive: false` stays permissive, as already covered by
// the "still succeeds" test just above.
describe('cart non-active-cart write gate (Step 8.5, QA F15)', () => {
  beforeEach(resetFixtures)

  it('cart.lines.add returns 409 cart_not_active carrying the real status for a merged cart', async () => {
    seededCarts[0] = { ...seededCarts[0], status: 'merged' }
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 1, addedByActorType: 'rep' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body: Record<string, unknown> }).body).toMatchObject({
      code: 'cart_not_active',
      status: 'merged',
    })
  })

  it('cart.lines.update returns 409 cart_not_active carrying the real status for an expired cart', async () => {
    seededCarts[0] = { ...seededCarts[0], status: 'expired' }
    seededCartLines = [{
      id: 'line-1', tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineNumber: 1,
      productId: 'product-1', variantId: null, sku: null, name: 'Widget', optionValues: null,
      quantity: '5', unitPriceNet: '10', unitPriceGross: '12', taxRate: '20', priceKindId: null,
      priceRowId: 'price-row-1', priceTierMinQuantity: 1, pricedAt: new Date(),
      lineTotals: makeLineTotalsFixture(5), discountTotalNet: null, promotionId: null,
      origin: 'customer', configuration: null, addedByActorType: 'buyer', addedByActorId: null,
      metadata: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    }]
    const handler = getHandler<CartLinesUpdateInput, CartLinesUpdateOutcome>('cart.lines.update')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1', quantity: 8 }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body: Record<string, unknown> }).body).toMatchObject({
      code: 'cart_not_active',
      status: 'expired',
    })
  })

  it('cart.lines.bulkAdd returns 409 cart_not_active carrying the real status for an abandoned cart', async () => {
    seededCarts[0] = { ...seededCarts[0], status: 'abandoned' }
    const handler = getHandler<CartLinesBulkAddInput, CartLinesBulkAddResult>('cart.lines.bulkAdd')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, addedByActorType: 'rep', lines: [{ productId: 'product-1', quantity: 1 }] },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body: Record<string, unknown> }).body).toMatchObject({
      code: 'cart_not_active',
      status: 'abandoned',
    })
  })

  // Regression: a `locked` cart MUST still win the distinguishable `423 cart_locked` —
  // `assertCartNotLocked` runs before the `requireActive` check this step changed, so this
  // step's edit must not have disturbed that ordering.
  it('cart.lines.add still returns 423 cart_locked (not 409) for a locked cart', async () => {
    seededCarts[0] = { ...seededCarts[0], status: 'locked', checkoutSessionId: 'checkout-session-1' }
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 1, addedByActorType: 'rep' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
    expect((captured as { body: Record<string, unknown> }).body).toMatchObject({ code: 'cart_locked' })
  })

  // Regression: a `kind = 'proposal'` cart is invisible to `loadMutableCart`'s own
  // `{ kind: 'basket' }` lookup filter entirely — it falls through the `!cart` branch (plain
  // `404 cart not found`), never reaching the `requireActive` check this step changed.
  it('cart.lines.add still returns a plain 404 (not 409) for a kind=proposal cart', async () => {
    seededCarts[0] = { ...seededCarts[0], kind: 'proposal' }
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 1, addedByActorType: 'rep' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
    expect((captured as { body: Record<string, unknown> }).body).not.toMatchObject({ code: 'cart_not_active' })
  })
})

// Step 8.2 — QA finding F12: every line-mutation command now re-evaluates promotions and
// recomputes `Cart.totals` as a whole-cart aggregate (`buildPromotionsEffectsPhase` +
// `buildRecomputeCartTotalsPhase`), instead of only ever touching the single line it
// mutates. These tests encode the exact live repro from the finding.
describe('cart promotions + totals recompute (Step 8.2, QA F12)', () => {
  beforeEach(resetFixtures)

  function makeBareLine(overrides: Row = {}): Row {
    return {
      id: 'line-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: CART_ID,
      lineNumber: 1,
      productId: 'product-1',
      variantId: null,
      sku: null,
      name: 'Widget',
      optionValues: null,
      quantity: '1',
      unitPriceNet: '10',
      unitPriceGross: '12',
      taxRate: '20',
      priceKindId: null,
      priceRowId: 'price-row-1',
      priceTierMinQuantity: 1,
      pricedAt: new Date(),
      lineTotals: makeLineTotalsFixture(1),
      discountTotalNet: null,
      promotionId: null,
      origin: 'customer',
      configuration: null,
      addedByActorType: 'buyer',
      addedByActorId: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }
  }

  // Regression guard: `Cart.totals` must never again land at the zeroed placeholder QA F12
  // found — a plain add with no promotions in play returns a real, non-zero aggregate.
  it('a plain add with no promotions returns non-zero totals, never the zeroed placeholder', async () => {
    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-1', quantity: 2, addedByActorType: 'rep' },
      ctx,
    )

    expect(result.status).toBe('added')
    expect(seededCarts[0].totals).toMatchObject({ grandTotalNetAmount: 20, grandTotalGrossAmount: 24 })
    expect(seededCarts[0].totalsComputedAt).toBeInstanceOf(Date)
  })

  // Live repro row 2: 2 units qualify for a "2+ items" promotion (simulated here via a
  // quantity-gated `promotionsService.evaluate` mock, since this is a Jest-level test of
  // cart's own orchestration, not the real rule engine). PATCH-ing the quantity to 1 must
  // drop the promotion out of totals AND clear the line's own stale `discountTotalNet` —
  // not merely halve it, since below the "2+" threshold the promotion no longer applies at
  // all. This also exercises `lib/promotionContext.ts`'s Step 8.2 fix: a line's discount is
  // re-derived from EVERY evaluation, not left stale from a PRIOR one that no longer holds.
  it('PATCH-ing quantity below a "2+ items" promotion threshold drops the discount and recomputes totals', async () => {
    seededCartLines = [makeBareLine({ quantity: '2', discountTotalNet: '-1.0000' })]
    seededCarts[0] = { ...seededCarts[0], totals: { subtotalNetAmount: 20, subtotalGrossAmount: 24, discountTotalAmount: 1, taxTotalAmount: 4, grandTotalNetAmount: 19, grandTotalGrossAmount: 23 } }
    const handler = getHandler<CartLinesUpdateInput, CartLinesUpdateOutcome>('cart.lines.update')
    const em = makeEm()
    const evaluate = jest.fn(async ({ items }: any) => {
      const line = items[0]
      if (Number(line.quantity) >= 2) {
        return {
          appliedPromotions: [
            {
              promotionId: 'promo-1',
              effects: [{ type: 'LINE_DISCOUNT', targetLineId: line.lineId, amountNet: '-1.0000', amountGross: '-1.2000' }],
            },
          ],
        }
      }
      return { appliedPromotions: [] }
    })
    const ctx = makeCtx({ em, promotionsService: { evaluate } })

    const result = await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1', quantity: 1 }, ctx)

    expect(result.status).toBe('updated')
    if (result.status !== 'updated') throw new Error('expected updated')
    expect(result.line.quantity).toBe('1')
    expect(result.line.discountTotalNet).toBeNull()
    expect(seededCartLines[0].discountTotalNet).toBeNull()
    expect(seededCarts[0].totals).toMatchObject({ discountTotalAmount: 0, grandTotalNetAmount: 10, grandTotalGrossAmount: 12 })
  })

  // Live repro row 3: deleting the cart's last remaining line must zero every total field,
  // never leave a stale non-zero `grandTotalNetAmount` behind.
  it('deleting the last remaining line zeroes every total field', async () => {
    seededCartLines = [makeBareLine()]
    seededCarts[0] = { ...seededCarts[0], totals: { subtotalNetAmount: 10, subtotalGrossAmount: 12, discountTotalAmount: 0, taxTotalAmount: 2, grandTotalNetAmount: 10, grandTotalGrossAmount: 12 } }
    const handler = getHandler<CartLinesRemoveInput, CartLinesRemoveResult>('cart.lines.remove')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1' }, ctx)

    expect(result.removed).toBe(true)
    expect(seededCarts[0].totals).toMatchObject({
      subtotalNetAmount: 0,
      subtotalGrossAmount: 0,
      discountTotalAmount: 0,
      taxTotalAmount: 0,
      grandTotalNetAmount: 0,
      grandTotalGrossAmount: 0,
    })
  })

  // Task brief point 7: undo must restore `Cart.totals`, not just the line — a REAL
  // `cart.reprice` dispatch (via a test-local `commandBus` that delegates to the shared
  // `commandRegistry`, not a faked result) is what makes this assertion meaningful.
  function makeRealDispatchingCommandBus() {
    return {
      execute: jest.fn(async (id: string, opts: any) => {
        const target = getHandler<any, any>(id)
        const result = await target.execute(opts.input, opts.ctx)
        return { result, logEntry: null }
      }),
    }
  }

  it('undo of cart.lines.add restores Cart.totals to the pre-mutation value, not just the line', async () => {
    seededCartLines = [makeBareLine({ id: 'line-0' })]
    seededCarts[0] = { ...seededCarts[0], totals: { subtotalNetAmount: 10, subtotalGrossAmount: 12, discountTotalAmount: 0, taxTotalAmount: 2, grandTotalNetAmount: 10, grandTotalGrossAmount: 12 } }
    seededProducts = [...seededProducts, makeProductFixture({ id: 'product-2', sku: 'WIDGET-2' })]

    const handler = getHandler<CartLinesAddInput, CartLinesAddOutcome>('cart.lines.add')
    const em = makeEm()
    const ctx = makeCtx({ em, commandBus: makeRealDispatchingCommandBus() })

    const addResult = await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, productId: 'product-2', quantity: 1, addedByActorType: 'rep' },
      ctx,
    )
    expect(addResult.status).toBe('added')
    expect(seededCarts[0].totals.grandTotalNetAmount).toBe(20)

    const logEntry = await handler.buildLog!({ input: {} as any, result: addResult, ctx, snapshots: {} })
    await handler.undo!({
      input: {} as any,
      ctx,
      logEntry: { ...(logEntry as any), commandPayload: (logEntry as any).payload } as unknown as CommandUndoLogEntry,
    })

    expect(seededCarts[0].totals.grandTotalNetAmount).toBe(10)
  })

  it('undo of cart.lines.remove restores Cart.totals to the pre-removal value, not just the line', async () => {
    seededCartLines = [makeBareLine()]
    seededCarts[0] = { ...seededCarts[0], totals: { subtotalNetAmount: 10, subtotalGrossAmount: 12, discountTotalAmount: 0, taxTotalAmount: 2, grandTotalNetAmount: 10, grandTotalGrossAmount: 12 } }

    const handler = getHandler<CartLinesRemoveInput, CartLinesRemoveResult>('cart.lines.remove')
    const em = makeEm()
    const ctx = makeCtx({ em, commandBus: makeRealDispatchingCommandBus() })

    const result = await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID, lineId: 'line-1' }, ctx)
    expect(result.removed).toBe(true)
    expect(seededCarts[0].totals.grandTotalNetAmount).toBe(0)

    const logEntry = await handler.buildLog!({ input: {} as any, result, ctx, snapshots: {} })
    await handler.undo!({
      input: {} as any,
      ctx,
      logEntry: { ...(logEntry as any), commandPayload: (logEntry as any).payload } as unknown as CommandUndoLogEntry,
    })

    expect(seededCartLines[0].deletedAt).toBeNull()
    expect(seededCarts[0].totals.grandTotalNetAmount).toBe(10)
  })
})
