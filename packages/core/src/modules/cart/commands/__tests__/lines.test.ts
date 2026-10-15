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
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeDataEngine() {
  return { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn(async () => {}) }
}

function makeCtx(opts: {
  em: unknown
  dataEngine?: unknown
  catalogBuyerPricingService?: unknown
  salesCalculationService?: unknown
  policyResolutionService?: unknown
  catalogScopedProductService?: unknown
}): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return opts.em
        if (token === 'dataEngine') return opts.dataEngine ?? makeDataEngine()
        if (token === 'catalogBuyerPricingService') {
          return opts.catalogBuyerPricingService ?? { resolveLinePrice: jest.fn(async () => makeResolvedLinePrice()) }
        }
        if (token === 'salesCalculationService') {
          return opts.salesCalculationService ?? { calculateLine: jest.fn(async ({ line }: any) => makeLineTotalsFixture(line.quantity)) }
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

  it('re-prices when the new quantity crosses the current price row tier boundary', async () => {
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
  })

  it('does not call the pricing service for a same-tier quantity change', async () => {
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
})
