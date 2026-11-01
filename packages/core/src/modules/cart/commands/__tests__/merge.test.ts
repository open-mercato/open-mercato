jest.mock('../../events', () => ({
  emitCartEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

// Step 2.9 — §8.4/D-R5-21's own "Consequences" bullet: "a `sourceToken` that resolves an
// identified basket of another buyer is the same `404`." Mocked the same way
// `lib/__tests__/currentCartRoute.identity-binding.test.ts` mocks it.
const mockGetCustomerAuthFromRequest = jest.fn()
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
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
let seededCartLines: FakeRow[] = []
let seededMergeLogs: FakeRow[] = []
let seededProducts: FakeRow[] = []

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === Cart) return seededCarts.find((row) => matchesWhere(row, where)) ?? null
  if (entity === CartLine) return seededCartLines.find((row) => matchesWhere(row, where)) ?? null
  return null
})

const mockFindWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === Cart) return seededCarts.filter((row) => matchesWhere(row, where))
  if (entity === CartLine) return seededCartLines.filter((row) => matchesWhere(row, where))
  if (entity === CartMergeLog) return seededMergeLogs.filter((row) => matchesWhere(row, where))
  if (entity === CatalogProduct) return seededProducts.filter((row) => matchesWhere(row, where))
  return []
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { Cart, CartLine, CartMergeLog, CartPromotionApplication } from '../../data/entities'
import { hashCartToken } from '../../lib/token'
import type { ResolvedCartRouteContext } from '../../lib/routeContext'
import { emitCartEvent as mockedEmitCartEvent } from '../../events'
import { repriceCartCommand } from '../cart'
import type { CartRepriceInput } from '../cart'
import type { CartMergeInput, CartMergeResult, CartMergeUndoInput, CartMergeUndoResult } from '../merge'
import '../merge'

const emitCartEventMock = mockedEmitCartEvent as jest.Mock

const TENANT_ID = 'tenant-merge-1'
const ORG_ID = 'org-merge-1'

function makeRouteContext(overrides: Partial<ResolvedCartRouteContext> = {}): ResolvedCartRouteContext {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: 'store-1',
    channel: 'storefront',
    assortmentScope: null,
    buyerDigest: 'digest-buyer-1',
    customerId: 'customer-1',
    customerIds: ['customer-1'],
    customerGroupIds: ['group-1'],
    customerUserId: 'customer-user-1',
    currencyCode: 'USD',
    locale: 'en-US',
    taxMode: 'gross',
    salesChannelId: 'sales-channel-1',
    priceKindId: null,
    ...overrides,
  }
}

function makeCartFixture(overrides: FakeRow = {}): FakeRow {
  const now = new Date('2026-03-01T00:00:00.000Z')
  return {
    id: 'cart-target',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    tokenHash: 'target-token-hash',
    storeId: 'store-1',
    channel: 'storefront',
    kind: 'basket',
    status: 'active',
    currencyCode: 'USD',
    locale: 'en-US',
    customerId: null,
    customerIds: [],
    customerUserId: null,
    customerGroupIds: [],
    priceKindId: null,
    taxMode: 'gross',
    email: null,
    note: null,
    buyerDigest: 'digest-guest',
    assortmentScopeHash: null,
    totals: {
      subtotalNetAmount: 0,
      subtotalGrossAmount: 0,
      discountTotalAmount: 0,
      taxTotalAmount: 0,
      grandTotalNetAmount: 0,
      grandTotalGrossAmount: 0,
    },
    totalsComputedAt: now,
    promotionEffects: null,
    requiresApproval: false,
    approvalId: null,
    metadata: null,
    salesChannelId: null,
    lastActivityAt: now,
    lastPriceChangeAt: null,
    lockedAt: null,
    lockExpiresAt: null,
    checkoutSessionId: null,
    mergedIntoCartId: null,
    resolvedAt: null,
    // Far in the future relative to real wall-clock time (restoreCartMerge's
    // active-vs-expired check compares against `new Date()`, not a fixed fixture clock) so
    // the "restore to active" path is the one these fixtures exercise by default; a test
    // for the "restore to expired" nuance overrides this explicitly.
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeLineTotalsFixture(quantity: number): FakeRow {
  return { subtotalNetAmount: quantity * 10, subtotalGrossAmount: quantity * 12, discountTotalAmount: 0, taxTotalAmount: quantity * 2, grandTotalNetAmount: quantity * 10, grandTotalGrossAmount: quantity * 12 }
}

function makeLineFixture(overrides: FakeRow = {}): FakeRow {
  const now = new Date('2026-03-01T00:00:00.000Z')
  return {
    id: `line-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: 'cart-target',
    lineNumber: 1,
    productId: 'product-1',
    variantId: null,
    sku: 'WIDGET-1',
    name: 'Widget',
    optionValues: null,
    quantity: '2',
    quantityUnit: null,
    uomSnapshot: null,
    unitPriceNet: '10',
    unitPriceGross: '12',
    taxRate: '20',
    priceKindId: null,
    priceRowId: 'price-row-1',
    priceTierMinQuantity: 1,
    pricedAt: now,
    lineTotals: makeLineTotalsFixture(2),
    discountTotalNet: null,
    promotionId: null,
    origin: 'customer',
    flagState: null,
    configuration: null,
    addedByActorType: 'buyer',
    addedByActorId: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

function makeProductFixture(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'product-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    deletedAt: null,
    minOrderQty: null,
    maxOrderQty: null,
    orderQtyIncrement: null,
    ...overrides,
  }
}

function makeMergeLogFixture(overrides: FakeRow = {}): FakeRow {
  return {
    id: `merge-log-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    sourceCartId: 'cart-guest',
    targetCartId: 'cart-target',
    strategy: 'sum',
    sourceSnapshot: { lines: [] },
    outcome: [],
    mergedByActorType: 'buyer',
    mergedByActorId: 'customer-user-1',
    proposalCartId: null,
    createdAt: new Date('2026-03-01T00:05:00.000Z'),
    ...overrides,
  }
}

function makeEm() {
  const rowEntityMap = new WeakMap<object, unknown>()
  const em: any = {
    fork: jest.fn(),
    find: jest.fn(async () => []),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CartMergeLog) return seededMergeLogs.find((row) => matchesWhere(row, where)) ?? null
      return null
    }),
    create: jest.fn((entity: unknown, data: FakeRow) => {
      const row: FakeRow = { id: `generated-${Math.random().toString(36).slice(2)}`, deletedAt: null, ...data }
      rowEntityMap.set(row, entity)
      return row
    }),
    persist: jest.fn((row: FakeRow) => {
      const entity = rowEntityMap.get(row)
      if (entity === CartLine) seededCartLines.push(row)
      else if (entity === CartMergeLog) seededMergeLogs.push(row)
    }),
    remove: jest.fn(() => undefined),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    // M1 fix — `cart.merge` now calls `recordBasketMutationActivity` on both carts
    // (`lib/cartActivity.ts`), which reactivates an `abandoned` basket via a raw
    // `em.nativeUpdate` rather than through `findWithDecryption`'s fixture lookup.
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, data: FakeRow) => {
      if (entity !== Cart) return 0
      const rows = seededCarts.filter((row) => matchesWhere(row, where))
      rows.forEach((row) => Object.assign(row, data))
      return rows.length
    }),
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeDataEngine() {
  return {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
  }
}

function makeSalesCalculationService() {
  return {
    calculateLine: jest.fn(async ({ line }: any) => ({
      line,
      netAmount: 0,
      grossAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      adjustments: [],
    })),
    calculateDocumentTotals: jest.fn(async () => ({
      kind: 'quote',
      currencyCode: 'USD',
      lines: [],
      adjustments: [],
      totals: {
        subtotalNetAmount: 0,
        subtotalGrossAmount: 0,
        discountTotalAmount: 0,
        taxTotalAmount: 0,
        grandTotalNetAmount: 0,
        grandTotalGrossAmount: 0,
      },
      metadata: {},
    })),
  }
}

/** Resolves `cart.reprice` by calling the REAL registered handler directly — same
 * precedent `commands/__tests__/cart.test.ts`/`promotions.test.ts` already establish. */
function makeFakeCommandBus(): CommandBus {
  return {
    execute: jest.fn(async (id: string, options: { input: unknown; ctx: CommandRuntimeContext }) => {
      if (id === 'cart.reprice') {
        const result = await repriceCartCommand.execute(options.input as CartRepriceInput, options.ctx)
        return { result }
      }
      throw new Error(`Unexpected command id in fake CommandBus: ${id}`)
    }),
  } as unknown as CommandBus
}

/**
 * Step 7.4 — default-visible: every requested product resolves to an unrestricted catalog
 * record, so the pre-existing rows 1-5/row-4 tests (none of which care about §6a.5's
 * merge-time visibility pass) keep admitting every line exactly as before this step. Only
 * the new §6a.5-specific tests below override this per-call.
 */
function makeDefaultCatalogScopedProductService() {
  return {
    loadScopedProducts: jest.fn(async (_em: unknown, ids: string[]) => {
      const result = new Map<string, { id: string; categoryIds: string[]; tagIds: string[]; isActive: boolean }>()
      for (const id of ids) result.set(id, { id, categoryIds: [], tagIds: [], isActive: true })
      return result
    }),
  }
}

function makeCtx(opts: {
  em: unknown
  catalogScopedProductService?: unknown
  // Step 3.2 (K3) — undefined by default, matching every pre-existing test's `Unexpected
  // DI token` throw caught internally by `tryResolveCustomerPurchaseApprovalService`,
  // degrading to "nothing withdrawn" exactly as before this Step.
  customerPurchaseApprovalService?: unknown
  // Step 6.1 (K11 gap-fill) — same "undefined degrades via Unexpected DI token" shape as
  // `customerPurchaseApprovalService` above, caught by `tryResolveCartCodeService`.
  promotionCodeService?: unknown
}): CommandRuntimeContext {
  const dataEngine = makeDataEngine()
  const salesCalculationService = makeSalesCalculationService()
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return opts.em
        if (token === 'dataEngine') return dataEngine
        if (token === 'commandBus') return makeFakeCommandBus()
        // Returning `{ priceRow: null }` unconditionally keeps `cart.reprice`'s own
        // per-line re-price a no-op for every test here — these tests are proving
        // `cart.merge`/`cart.mergeUndo`'s OWN line/ownership/log mutations, not reprice's.
        if (token === 'catalogBuyerPricingService') return { resolveLinePrice: jest.fn(async () => ({ priceRow: null })) }
        if (token === 'salesCalculationService') return salesCalculationService
        if (token === 'promotionsService') return { evaluate: jest.fn(async () => ({ appliedPromotions: [] })), extendReservation: jest.fn(), releaseCode: jest.fn() }
        if (token === 'policyResolutionService') throw new Error('no policy resolver registered in this test')
        if (token === 'catalogScopedProductService') return opts.catalogScopedProductService ?? makeDefaultCatalogScopedProductService()
        if (token === 'customerPurchaseApprovalService') {
          if (opts.customerPurchaseApprovalService !== undefined) return opts.customerPurchaseApprovalService
          throw new Error(`Unexpected DI token: ${token}`)
        }
        if (token === 'promotionCodeService') {
          if (opts.promotionCodeService !== undefined) return opts.promotionCodeService
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

function getMergeHandler() {
  const handler = commandRegistry.get<CartMergeInput, CartMergeResult>('cart.merge')
  expect(handler).toBeDefined()
  return handler!
}

function getUndoHandler() {
  const handler = commandRegistry.get<CartMergeUndoInput, CartMergeUndoResult>('cart.mergeUndo')
  expect(handler).toBeDefined()
  return handler!
}

beforeEach(() => {
  jest.clearAllMocks()
  seededCarts = []
  seededCartLines = []
  seededMergeLogs = []
  seededProducts = [makeProductFixture()]
})

describe('cart.merge — §7.1 policy rows', () => {
  it('row 1: adopts the guest cart when the session (target) cart is empty, rotates its token and reassigns ownership', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash', customerId: null, customerUserId: null }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), customerId: null, customerUserId: null, buyerDigest: 'digest-guest' }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-guest-1', cartId: 'cart-guest', productId: 'product-1', quantity: '3' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })
    const routeContext = makeRouteContext()

    const result = await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext },
      ctx,
    )

    expect(result.mergeSummary.strategy).toBe('replace')
    expect(result.mergeSummary.adopted).toBe(true)
    expect(result.cart.id).toBe('cart-guest')
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(10)

    const guestCart = seededCarts.find((row) => row.id === 'cart-guest')!
    expect(guestCart.customerId).toBe('customer-1')
    expect(guestCart.customerUserId).toBe('customer-user-1')
    expect(hashCartToken(result.token)).toBe(guestCart.tokenHash)

    const targetCart = seededCarts.find((row) => row.id === 'cart-target')!
    expect(targetCart.status).toBe('merged')
    expect(targetCart.mergedIntoCartId).toBe('cart-guest')
    expect(targetCart.resolvedAt).not.toBeNull()

    expect(seededMergeLogs).toHaveLength(1)
    expect(seededMergeLogs[0]).toMatchObject({ sourceCartId: 'cart-target', targetCartId: 'cart-guest', strategy: 'replace' })
    expect(emitCartEventMock).toHaveBeenCalledWith('cart.cart.adopted', expect.objectContaining({ cartId: 'cart-guest' }))
    expect(emitCartEventMock).toHaveBeenCalledWith('cart.cart.merged', expect.objectContaining({ sourceCartId: 'cart-target', targetCartId: 'cart-guest', strategy: 'replace' }))
  })

  it('row 2: keeps the target cart unchanged when the guest (source) cart is empty', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token') }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '1' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext: makeRouteContext() },
      ctx,
    )

    expect(result.mergeSummary.strategy).toBe('keep_target')
    expect(result.mergeSummary.adopted).toBe(false)
    expect(result.cart.id).toBe('cart-target')
    expect(result.mergeSummary.lines).toEqual([])

    const targetLine = seededCartLines.find((row) => row.id === 'line-target-1')!
    expect(targetLine.quantity).toBe('1')

    const guestCart = seededCarts.find((row) => row.id === 'cart-guest')!
    expect(guestCart.status).toBe('merged')
    expect(guestCart.mergedIntoCartId).toBe('cart-target')
  })

  it('rows 3-5 combined: unions a disjoint line, sums a matching line, and keeps a differently-configured line separate', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token') }),
    ]
    seededCartLines = [
      // Target already has product-1 (no configuration) and product-3 (configured).
      makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', variantId: null, configuration: null, quantity: '2', lineNumber: 1 }),
      makeLineFixture({ id: 'line-target-3', cartId: 'cart-target', productId: 'product-3', variantId: null, configuration: { engraving: 'A' }, quantity: '1', lineNumber: 2 }),
      // Guest has: product-1 matching (sum), product-2 disjoint (union), product-3 with a
      // DIFFERENT configuration (conflict -> kept separate).
      makeLineFixture({ id: 'line-guest-1', cartId: 'cart-guest', productId: 'product-1', variantId: null, configuration: null, quantity: '3', lineNumber: 1 }),
      makeLineFixture({ id: 'line-guest-2', cartId: 'cart-guest', productId: 'product-2', variantId: null, configuration: null, quantity: '5', lineNumber: 2 }),
      makeLineFixture({ id: 'line-guest-3', cartId: 'cart-guest', productId: 'product-3', variantId: null, configuration: { engraving: 'B' }, quantity: '1', lineNumber: 3 }),
    ]
    seededProducts = [makeProductFixture({ id: 'product-1' }), makeProductFixture({ id: 'product-2' }), makeProductFixture({ id: 'product-3' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext: makeRouteContext() },
      ctx,
    )

    expect(result.mergeSummary.strategy).toBe('sum')
    expect(result.mergeSummary.counts).toMatchObject({ merged: 2, summed: 1, capped: 0 })

    const summedLine = seededCartLines.find((row) => row.id === 'line-target-1')!
    expect(summedLine.quantity).toBe('5')

    const unionLine = seededCartLines.find((row) => row.cartId === 'cart-target' && row.productId === 'product-2')
    expect(unionLine).toBeDefined()
    expect(unionLine!.quantity).toBe('5')
    expect(unionLine!.addedByActorType).toBe('merge')

    const conflictLines = seededCartLines.filter((row) => row.cartId === 'cart-target' && row.productId === 'product-3')
    expect(conflictLines).toHaveLength(2)
    const configs = conflictLines.map((row) => row.configuration?.engraving)
    expect(configs.sort()).toEqual(['A', 'B'])

    expect(seededMergeLogs[0].outcome).toHaveLength(3)
  })

  it('row 4: caps a summed quantity at maxOrderQuantity and reports disposition capped', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token') }),
    ]
    seededCartLines = [
      makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '8', lineNumber: 1 }),
      makeLineFixture({ id: 'line-guest-1', cartId: 'cart-guest', productId: 'product-1', quantity: '5', lineNumber: 1 }),
    ]
    seededProducts = [makeProductFixture({ id: 'product-1', maxOrderQty: 10 })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext: makeRouteContext() },
      ctx,
    )

    expect(result.mergeSummary.counts).toMatchObject({ capped: 1, summed: 0 })
    const targetLine = seededCartLines.find((row) => row.id === 'line-target-1')!
    expect(targetLine.quantity).toBe('10')
    const entry = seededMergeLogs[0].outcome[0]
    expect(entry.disposition).toBe('capped')
    expect(entry.previousTargetQuantity).toBe('8')
  })

  it('rejects merging a cart into itself', async () => {
    seededCarts = [makeCartFixture({ id: 'cart-target', tokenHash: hashCartToken('same-token') })]
    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'same-token', routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(400)
  })

  it('rejects a merge across different stores or currencies with cart_merge_scope_mismatch (400)', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash', storeId: 'store-1', currencyCode: 'USD' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-token'), storeId: 'store-2', currencyCode: 'USD' }),
    ]
    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-token', routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number; body?: { code?: string } }).status).toBe(400)
    expect((captured as { body?: { code?: string } }).body?.code).toBe('cart_merge_scope_mismatch')
  })

  it('404s when the sourceToken does not resolve a cart', async () => {
    seededCarts = [makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' })]
    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'nonexistent', routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  // Step 2.9 — §8.4/D-R5-21's own "Consequences" bullet: "a `sourceToken` that resolves an
  // identified basket of another buyer is the same `404`." The TARGET cart's own identity
  // binding is enforced one layer up, at the route edge (`lib/currentCartRoute.ts`, before
  // this command ever runs); these three tests cover the SOURCE side, which this command
  // resolves itself.
  it('404s when sourceToken resolves another buyer\'s identified basket and the requester has no session', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('other-buyer-token'), customerUserId: 'customer-user-other-buyer' }),
    ]
    mockGetCustomerAuthFromRequest.mockResolvedValue(null)
    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = { ...makeCtx({ em }), request: new Request('https://example.com') }

    let captured: unknown
    try {
      await handler.execute({ targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'other-buyer-token', routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  it('404s when sourceToken resolves another buyer\'s identified basket even with the requester\'s OWN valid session for a different customer', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('other-buyer-token'), customerUserId: 'customer-user-other-buyer' }),
    ]
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-requester', type: 'customer' })
    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = { ...makeCtx({ em }), request: new Request('https://example.com') }

    let captured: unknown
    try {
      await handler.execute({ targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'other-buyer-token', routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  it('merges normally when sourceToken resolves an identified basket belonging to the SAME requester as the presented session', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('own-identified-source-token'), customerUserId: 'customer-user-1' }),
    ]
    seededCartLines = [
      makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '2', lineNumber: 1 }),
      makeLineFixture({ id: 'line-guest-1', cartId: 'cart-guest', productId: 'product-2', quantity: '3', lineNumber: 1 }),
    ]
    seededProducts = [makeProductFixture({ id: 'product-1' }), makeProductFixture({ id: 'product-2' })]
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-1', type: 'customer' })
    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = { ...makeCtx({ em }), request: new Request('https://example.com') }

    const result = await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'own-identified-source-token', routeContext: makeRouteContext() },
      ctx,
    )

    expect(result.mergeSummary.strategy).toBe('sum')
    expect(result.mergeSummary.counts.merged).toBe(1)
  })

  // Step 7.5 — §9: a locked TARGET cart gets the distinguishable 423, not the generic 404
  // collapse a plain non-active target (e.g. `merged`/`expired`) would fall into.
  it('rejects a merge into a locked TARGET cart with 423 cart_locked, carrying its checkoutSessionId', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash', status: 'locked', checkoutSessionId: 'checkout-session-1' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-token') }),
    ]
    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-token', routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({
      code: 'cart_locked',
      checkoutSessionId: 'checkout-session-1',
    })
  })

  // Contrast case: a locked GUEST/source cart is a documented judgment call left OUT of the
  // 423 distinction — it still folds into the generic 404 collapse, same as any other
  // non-active source status, rather than getting its own signal.
  it('folds a locked GUEST/source cart into the generic 404 collapse, not a 423', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-token'), status: 'locked', checkoutSessionId: 'checkout-session-2' }),
    ]
    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-token', routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  // M1 (re-review of 2f95ebf700) — §9's "any basket mutation reactivates an abandoned
  // basket" applies to BOTH sides of a merge, same as `cart.lines.*`/`cart.promotions.*`
  // (#7880). Before this fix, `merge.ts`'s status gate 404'd on an `abandoned` cart instead
  // of reactivating it first.
  it('reactivates an abandoned TARGET cart instead of 404ing, then merges normally (§9)', async () => {
    seededCarts = [
      makeCartFixture({
        id: 'cart-target',
        tokenHash: 'target-token-hash',
        status: 'abandoned',
        resolvedAt: new Date('2026-02-25T00:00:00.000Z'),
        expiresAt: new Date('2026-02-26T00:00:00.000Z'),
        customerId: 'customer-1',
      }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token') }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '1' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext: makeRouteContext() },
      ctx,
    )

    expect(result.mergeSummary.strategy).toBe('keep_target')
    expect(result.cart.id).toBe('cart-target')

    const targetCart = seededCarts.find((row) => row.id === 'cart-target')!
    expect(targetCart.status).toBe('active')
    expect(targetCart.resolvedAt).toBeNull()
    expect(targetCart.expiresAt.getTime()).toBeGreaterThan(new Date('2026-02-26T00:00:00.000Z').getTime())
  })

  it('reactivates an abandoned GUEST (source) cart instead of 404ing, then merges normally (§9)', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({
        id: 'cart-guest',
        tokenHash: hashCartToken('guest-plain-token'),
        status: 'abandoned',
        resolvedAt: new Date('2026-02-25T00:00:00.000Z'),
        expiresAt: new Date('2026-02-26T00:00:00.000Z'),
        customerId: null,
      }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-guest-1', cartId: 'cart-guest', productId: 'product-1', quantity: '1' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext: makeRouteContext() },
      ctx,
    )

    // The TARGET cart is empty, so this lands on row 1 (adopt): the guest cart survives.
    // Before this fix, the abandoned guest cart's own status gate 404'd before the merge
    // policy ever got to pick a row.
    expect(result.mergeSummary.strategy).toBe('replace')
    expect(result.mergeSummary.adopted).toBe(true)
    expect(result.cart.id).toBe('cart-guest')

    const survivingCart = seededCarts.find((row) => row.id === 'cart-guest')!
    // `recordBasketMutationActivity` reactivated it to `active` before the adopt path ran.
    expect(survivingCart.status).toBe('active')
    expect(survivingCart.resolvedAt).toBeNull()

    const absorbedCart = seededCarts.find((row) => row.id === 'cart-target')!
    expect(absorbedCart.status).toBe('merged')
    expect(absorbedCart.resolvedAt).not.toBeNull()
  })
})

// Step 7.4 — §6a.5's merge-time re-visibility pass (R13 regression suite). Only the rows
// 3-5 union/sum/conflict branch ever calls `buildMergeOutcome` (rows 1/2 — adopt/keep_target
// — admit no NEW incoming line into a different cart at all), so every test here seeds both
// carts non-empty to land in that branch.
describe('cart.merge — §6a.5 merge-time re-visibility pass (Step 7.4)', () => {
  it('TC-CART-R13-01: admits a visible incoming line, rejects a restricted one — absent from the target, present in mergeSummary/CartMergeLog.outcome with disposition rejected and targetLineId null, still present in source_snapshot', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash', channel: 'storefront' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), channel: 'agent' }),
    ]
    seededCartLines = [
      makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-visible', quantity: '1', lineNumber: 1 }),
      // The source (exempt-channel) cart holds one visible and one restricted line.
      makeLineFixture({ id: 'line-guest-visible', cartId: 'cart-guest', productId: 'product-visible', quantity: '2', lineNumber: 1 }),
      makeLineFixture({ id: 'line-guest-restricted', cartId: 'cart-guest', productId: 'product-restricted', quantity: '1', lineNumber: 2 }),
    ]
    seededProducts = [makeProductFixture({ id: 'product-visible' }), makeProductFixture({ id: 'product-restricted' })]

    const catalogScopedProductService = {
      loadScopedProducts: jest.fn(async () =>
        new Map([
          ['product-visible', { id: 'product-visible', categoryIds: ['cat-retail'], tagIds: [], isActive: true }],
          ['product-restricted', { id: 'product-restricted', categoryIds: ['cat-wholesale'], tagIds: [], isActive: true }],
        ]),
      ),
    }

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em, catalogScopedProductService })
    const routeContext = makeRouteContext({ assortmentScope: [{ categoryIds: ['cat-retail'] }] })

    const result = await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext },
      ctx,
    )

    // Admitted: the visible line summed into the existing target line.
    expect(result.mergeSummary.counts).toMatchObject({ summed: 1, rejected: 1 })
    const summedLine = seededCartLines.find((row) => row.id === 'line-target-1')!
    expect(summedLine.quantity).toBe('3')

    // Rejected: absent from the target's actual lines.
    expect(seededCartLines.some((row) => row.productId === 'product-restricted' && row.cartId === 'cart-target')).toBe(false)

    const rejectedSummaryEntry = result.mergeSummary.lines.find((entry) => entry.sourceLineId === 'line-guest-restricted')!
    expect(rejectedSummaryEntry).toMatchObject({ disposition: 'rejected', targetLineId: null, reason: 'product_unavailable' })

    const rejectedLogEntry = (seededMergeLogs[0].outcome as FakeRow[]).find((entry) => entry.sourceLineId === 'line-guest-restricted')
    expect(rejectedLogEntry).toMatchObject({ disposition: 'rejected', targetLineId: null, reason: 'product_unavailable' })

    const snapshotLineIds = (seededMergeLogs[0].sourceSnapshot.lines as FakeRow[]).map((line) => line.id)
    expect(snapshotLineIds).toContain('line-guest-restricted')

    const visibilityRejectedCalls = emitCartEventMock.mock.calls.filter(([eventId]) => eventId === 'cart.line.visibility_rejected')
    expect(visibilityRejectedCalls).toHaveLength(1)
    expect(visibilityRejectedCalls[0][1]).toMatchObject({ cartId: 'cart-target', rejectedCount: 1, triggeredBy: 'merge' })
  })

  it('admits everything unconditionally when assortment enforcement is off (non-storefront survivor with no resolved scope) — never calls the catalog service', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash', channel: 'pos' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), channel: 'pos' }),
    ]
    seededCartLines = [
      makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '1', lineNumber: 1 }),
      makeLineFixture({ id: 'line-guest-1', cartId: 'cart-guest', productId: 'product-2', quantity: '1', lineNumber: 1 }),
    ]
    seededProducts = [makeProductFixture({ id: 'product-1' }), makeProductFixture({ id: 'product-2' })]

    const loadScopedProducts = jest.fn(async () => new Map())
    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em, catalogScopedProductService: { loadScopedProducts } })
    // `assortmentScope: undefined` — no resolved scope — combined with a non-storefront
    // survivor channel is the "enforcement off" condition `shouldEnforceAssortmentScope`
    // tests for (§6a.1b). Not reachable through the public `/current/merge` route today
    // (its route edge always resolves a scope), but this module's OWN enforcement-key
    // helper is a pure function this test exercises directly, same defense-in-depth
    // precedent `cart.create`'s own tests already use for a staff `ctx.auth` actor.
    const routeContext = { ...makeRouteContext(), assortmentScope: undefined } as unknown as ResolvedCartRouteContext

    const result = await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext },
      ctx,
    )

    expect(result.mergeSummary.counts).toMatchObject({ merged: 1, rejected: 0 })
    expect(seededCartLines.some((row) => row.productId === 'product-2' && row.cartId === 'cart-target')).toBe(true)
    expect(loadScopedProducts).not.toHaveBeenCalled()
  })

  // Orchestrating-session fix on top of the dispatched agent's own work: §6a.5's pass above
  // only ever runs inside `buildMergeOutcome`, which an ADOPT merge (row 1) never calls at
  // all — the survivor is the SOURCE cart itself, carried over with its existing lines
  // untouched, so without this test's own fix those lines would never be re-checked against
  // the buyer's newly-resolved scope. The flagged-not-rejected §6a.2 pass is reused here
  // (not §6a.5's reject-on-admission one) because these lines already exist in
  // what is now the live cart — the realistic case this matters for (an `agent`/`api`-
  // channel cart's own lines surviving adoption unchecked) is a narrower residual: `channel`
  // is immutable (§4.1) and `shouldEnforceAssortmentScope` gates on it, so this fix closes
  // the case that actually matters today — a `storefront` guest cart whose lines were priced
  // against anonymous/no-membership visibility and must be re-verified the instant a real
  // customer identity (and its own group memberships) attaches at login.
  it('row 1 (adopt): the survivor (former guest) cart\'s own pre-existing lines are flagged if the buyer\'s newly-resolved scope now excludes them', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash', channel: 'storefront', customerId: null, customerUserId: null }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), channel: 'storefront', customerId: null, customerUserId: null, buyerDigest: 'digest-guest' }),
    ]
    seededCartLines = [
      makeLineFixture({ id: 'line-guest-1', cartId: 'cart-guest', productId: 'product-now-restricted', quantity: '1', lineNumber: 1 }),
    ]
    seededProducts = [makeProductFixture({ id: 'product-now-restricted' })]

    const catalogScopedProductService = {
      loadScopedProducts: jest.fn(async () =>
        new Map([['product-now-restricted', { id: 'product-now-restricted', categoryIds: ['cat-wholesale'], tagIds: [], isActive: true }]]),
      ),
    }

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em, catalogScopedProductService })
    const routeContext = makeRouteContext({ assortmentScope: [{ categoryIds: ['cat-retail'] }] })

    await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext },
      ctx,
    )

    const survivorLine = seededCartLines.find((row) => row.id === 'line-guest-1')!
    expect(survivorLine.flagState).toBe('product_unavailable')
    expect(survivorLine.deletedAt).toBeNull()

    const visibilityRejectedCalls = emitCartEventMock.mock.calls.filter(([eventId]) => eventId === 'cart.line.visibility_rejected')
    expect(visibilityRejectedCalls.some(([, payload]) => (payload as FakeRow).triggeredBy === 'reprice')).toBe(true)
  })
})

// Step 3.2 (K3, §7.4) — "A source basket whose approval_id names a pending approval has it
// withdrawn ... and its awaiting_approval_since is cleared." Uses row 2 (keep_target, the
// guest cart is empty) as the minimal scenario: the absorbed cart still transitions to
// `merged` regardless of whether any lines moved.
describe('cart.merge — K3 source-side approval withdrawal (§7.4)', () => {
  it('withdraws a pending approval on the absorbed (source) cart and clears its awaiting_approval_since', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({
        id: 'cart-guest',
        tokenHash: hashCartToken('guest-plain-token'),
        approvalId: 'approval-1',
        awaitingApprovalSince: new Date('2026-02-28T00:00:00.000Z'),
      }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '2' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const withdrawApproval = jest.fn(async () => ({}))
    const ctx = makeCtx({ em, customerPurchaseApprovalService: { withdrawApproval } })

    await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext: makeRouteContext() },
      ctx,
    )

    expect(withdrawApproval).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      approvalId: 'approval-1',
      actor: { actorType: 'system', reason: 'cart_merged' },
    })
    const guestCart = seededCarts.find((row) => row.id === 'cart-guest')!
    expect(guestCart.status).toBe('merged')
    expect(guestCart.awaitingApprovalSince).toBeNull()
  })

  it('leaves awaiting_approval_since alone when the source cart has no approvalId', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), approvalId: null }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '2' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const withdrawApproval = jest.fn()
    const ctx = makeCtx({ em, customerPurchaseApprovalService: { withdrawApproval } })

    await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext: makeRouteContext() },
      ctx,
    )

    expect(withdrawApproval).not.toHaveBeenCalled()
  })
})

// Step 6.1 (K11 gap-fill) — `releaseCartCodeReservations` (`lib/sweepers.ts`) was only ever
// wired into the expire/abandon/proposal-expiry sweeps; a merge-absorbed cart never passes
// through any of those (it is already `merged`, terminal), so its own reserved-but-unused
// promotion codes dangled until `promotions`' slow TTL sweep caught them. This proves the
// absorbed cart's `CartPromotionApplication` rows are released by `cartId`, same as every
// sweep call site.
describe('cart.merge — K11 absorbed-cart code reservation release', () => {
  it('releases every distinct codeId the absorbed (source) cart still holds', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token') }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '2' })]

    const handler = getMergeHandler()
    const em = makeEm()
    em.find.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CartPromotionApplication) {
        const rows = [
          { id: 'app-1', cartId: 'cart-guest', tenantId: TENANT_ID, organizationId: ORG_ID, codeId: 'code-1' },
          { id: 'app-2', cartId: 'cart-guest', tenantId: TENANT_ID, organizationId: ORG_ID, codeId: 'code-2' },
        ]
        return rows.filter((row) => matchesWhere(row, where))
      }
      return []
    })
    const releaseCode = jest.fn(async () => undefined)
    const ctx = makeCtx({ em, promotionCodeService: { releaseCode } })

    await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext: makeRouteContext() },
      ctx,
    )

    expect(releaseCode).toHaveBeenCalledTimes(2)
    expect(releaseCode).toHaveBeenCalledWith(em, 'code-1', 'cart-guest', { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(releaseCode).toHaveBeenCalledWith(em, 'code-2', 'cart-guest', { tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('does nothing when the absorbed cart holds no code reservations', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token') }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '2' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const releaseCode = jest.fn(async () => undefined)
    const ctx = makeCtx({ em, promotionCodeService: { releaseCode } })

    await handler.execute(
      { targetCartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, sourceToken: 'guest-plain-token', routeContext: makeRouteContext() },
      ctx,
    )

    expect(releaseCode).not.toHaveBeenCalled()
  })
})

describe('cart.mergeUndo', () => {
  it('restores a summed line back to its exact pre-merge quantity', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), status: 'merged', mergedIntoCartId: 'cart-target' }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '5' })]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-1',
        sourceCartId: 'cart-guest',
        targetCartId: 'cart-target',
        strategy: 'sum',
        outcome: [{ sourceLineId: 'line-guest-1', targetLineId: 'line-target-1', disposition: 'summed', previousTargetQuantity: '2' }],
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute({ cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() }, ctx)

    expect(result.cart.id).toBe('cart-target')
    const line = seededCartLines.find((row) => row.id === 'line-target-1')!
    expect(line.quantity).toBe('2')
    const guestCart = seededCarts.find((row) => row.id === 'cart-guest')!
    expect(guestCart.status).toBe('active')
    expect(guestCart.mergedIntoCartId).toBeNull()
  })

  it('deletes a union-created target line on undo', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), status: 'merged', mergedIntoCartId: 'cart-target' }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-new', cartId: 'cart-target', productId: 'product-2', quantity: '5' })]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-2',
        sourceCartId: 'cart-guest',
        targetCartId: 'cart-target',
        strategy: 'sum',
        outcome: [{ sourceLineId: 'line-guest-2', targetLineId: 'line-target-new', disposition: 'merged' }],
        createdAt: new Date(Date.now() - 1 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    await handler.execute({ cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() }, ctx)

    const line = seededCartLines.find((row) => row.id === 'line-target-new')!
    expect(line.deletedAt).not.toBeNull()
  })

  // Step 3.2 (K3, §7.4) regression guard — "Undo of a merge → target recomputes; approvals
  // are not restored automatically." `restoreCartMerge` touches lines, the survivor's buyer
  // identity (adoption only) and the merge log's own `undoneAt` — never `approvalId`/
  // `awaitingApprovalSince` on either cart. The absorbed cart's approval, already withdrawn
  // by the original merge (K3 source-side rule), stays withdrawn: undo restores the CART to
  // `active`, never the approval to `pending`.
  it('does not restore the absorbed cart\'s withdrawn approval, and never calls into customer_groups at all', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({
        id: 'cart-guest',
        tokenHash: hashCartToken('guest-plain-token'),
        status: 'merged',
        mergedIntoCartId: 'cart-target',
        // Already withdrawn by the original merge (K3) — `approval_id` stays pointed at
        // the withdrawn approval (§9a.4: never cleared by cart-lifecycle events),
        // `awaiting_approval_since` already null.
        approvalId: 'approval-1',
        awaitingApprovalSince: null,
      }),
    ]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-approval-1',
        sourceCartId: 'cart-guest',
        targetCartId: 'cart-target',
        strategy: 'keep_target',
        outcome: [],
        createdAt: new Date(Date.now() - 1 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    const em = makeEm()
    const withdrawApproval = jest.fn()
    const requestApproval = jest.fn()
    const ctx = makeCtx({ em, customerPurchaseApprovalService: { withdrawApproval, requestApproval } })

    await handler.execute({ cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() }, ctx)

    const guestCart = seededCarts.find((row) => row.id === 'cart-guest')!
    expect(guestCart.status).toBe('active')
    expect(guestCart.approvalId).toBe('approval-1')
    expect(guestCart.awaitingApprovalSince).toBeNull()
    expect(withdrawApproval).not.toHaveBeenCalled()
    expect(requestApproval).not.toHaveBeenCalled()
  })

  it('refuses an undo attempt past the 15-minute window with a 409', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), status: 'merged', mergedIntoCartId: 'cart-target' }),
    ]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-3',
        sourceCartId: 'cart-guest',
        targetCartId: 'cart-target',
        strategy: 'keep_target',
        outcome: [],
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body: FakeRow }).body.code).toBe('merge_undo_window_expired')
  })

  it('restores the absorbed cart to expired, not active, when its own expiresAt has already passed', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({
        id: 'cart-guest',
        tokenHash: hashCartToken('guest-plain-token'),
        status: 'merged',
        mergedIntoCartId: 'cart-target',
        expiresAt: new Date(Date.now() - 1000),
      }),
    ]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-4',
        sourceCartId: 'cart-guest',
        targetCartId: 'cart-target',
        strategy: 'keep_target',
        outcome: [],
        createdAt: new Date(Date.now() - 1 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    await handler.execute({ cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() }, ctx)

    const guestCart = seededCarts.find((row) => row.id === 'cart-guest')!
    expect(guestCart.status).toBe('expired')
    expect(guestCart.resolvedAt).not.toBeNull()
  })

  it('404s when no merge log exists for the current cart', async () => {
    seededCarts = [makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' })]
    const handler = getUndoHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  // Review finding: the same merge log could be undone repeatedly within the 15-minute
  // window, re-applying `previousTargetQuantity` and wiping any edit made after the first
  // undo.
  it('rejects a second undo of the same merge log with a distinct 409, instead of re-applying previousTargetQuantity', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), status: 'merged', mergedIntoCartId: 'cart-target' }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '5' })]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-5',
        sourceCartId: 'cart-guest',
        targetCartId: 'cart-target',
        strategy: 'sum',
        outcome: [{ sourceLineId: 'line-guest-1', targetLineId: 'line-target-1', disposition: 'summed', previousTargetQuantity: '2' }],
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    await handler.execute(
      { cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() },
      makeCtx({ em: makeEm() }),
    )

    // The buyer edits the restored line after the first undo — a second undo call must
    // not wipe this.
    const line = seededCartLines.find((row) => row.id === 'line-target-1')!
    line.quantity = '9'

    let captured: unknown
    try {
      await handler.execute(
        { cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() },
        makeCtx({ em: makeEm() }),
      )
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body: FakeRow }).body.code).toBe('merge_already_undone')
    expect(seededCartLines.find((row) => row.id === 'line-target-1')!.quantity).toBe('9')
  })

  // Review finding: the survivor cart's state was never checked — a buyer who merges,
  // locks and converts within the window could still undo-merge, soft-deleting lines from
  // the locked/converted cart.
  it('refuses to undo-merge when the current (survivor) cart is locked', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash', status: 'locked', checkoutSessionId: 'checkout-session-1' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), status: 'merged', mergedIntoCartId: 'cart-target' }),
    ]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-6',
        sourceCartId: 'cart-guest',
        targetCartId: 'cart-target',
        strategy: 'keep_target',
        outcome: [],
        createdAt: new Date(Date.now() - 1 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
    const guestCart = seededCarts.find((row) => row.id === 'cart-guest')!
    expect(guestCart.status).toBe('merged')
  })

  it('refuses to undo-merge when the current (survivor) cart has already converted', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash', status: 'converted' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token'), status: 'merged', mergedIntoCartId: 'cart-target' }),
    ]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-7',
        sourceCartId: 'cart-guest',
        targetCartId: 'cart-target',
        strategy: 'keep_target',
        outcome: [],
        createdAt: new Date(Date.now() - 1 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() }, ctx)
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body: FakeRow }).body.code).toBe('cart_not_active')
    const guestCart = seededCarts.find((row) => row.id === 'cart-guest')!
    expect(guestCart.status).toBe('merged')
  })
})

// Step 3.4 (§7a.4, D-R5-13/D-R5-25) — `cart.merge`'s `proposalCartId`/`lines` input variant.
// `cart.proposal.accept` (`commands/proposal.ts`) is the one real caller; these tests call
// `cart.merge` directly, same precedent the guest-merge suite above already sets, to prove
// the mechanics (visibility re-check, outcome building, `CartMergeLog`, mandatory re-price)
// without re-building `cart.proposal.accept`'s own acceptanceToken/binding machinery here —
// that machinery is `commands/__tests__/proposal.test.ts`'s own scope.
describe('cart.merge — §7a.4 proposal acceptance (manual strategy, Step 3.4)', () => {
  const PROPOSAL_ID = 'proposal-1'

  function makeProposalFixture(overrides: FakeRow = {}): FakeRow {
    return makeCartFixture({
      id: PROPOSAL_ID,
      kind: 'proposal',
      proposedToCartId: 'cart-target',
      status: 'active',
      resolvedAt: null,
      tokenHash: 'proposal-token-hash-unused',
      ...overrides,
    })
  }

  it('merges exactly the selected lines, records unselected lines as declined (never merged, never deleted), and sets strategy manual + proposalCartId on the merge log', async () => {
    seededCarts = [makeCartFixture({ id: 'cart-target' }), makeProposalFixture()]
    seededCartLines = [
      makeLineFixture({ id: 'proposal-line-1', cartId: PROPOSAL_ID, productId: 'product-1', quantity: '2' }),
      makeLineFixture({ id: 'proposal-line-2', cartId: PROPOSAL_ID, productId: 'product-2', quantity: '1' }),
    ]
    seededProducts.push(makeProductFixture({ id: 'product-2' }))

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      {
        targetCartId: 'cart-target',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        proposalCartId: PROPOSAL_ID,
        lines: [
          { proposalLineId: 'proposal-line-1', accepted: true },
          { proposalLineId: 'proposal-line-2', accepted: false },
        ],
        routeContext: makeRouteContext(),
      } as CartMergeInput,
      ctx,
    )

    expect(result.mergeSummary.strategy).toBe('manual')
    expect(result.mergeSummary.adopted).toBe(false)
    expect(result.mergeSummary.counts).toMatchObject({ merged: 1, declined: 1 })
    expect(result.cart.id).toBe('cart-target')
    expect(typeof result.token).toBe('string')

    const newTargetLine = seededCartLines.find((row) => row.cartId === 'cart-target' && row.productId === 'product-1')
    expect(newTargetLine).toBeDefined()
    const declinedLine = seededCartLines.find((row) => row.id === 'proposal-line-2')!
    expect(declinedLine.cartId).toBe(PROPOSAL_ID)
    expect(declinedLine.deletedAt).toBeNull()

    expect(seededMergeLogs).toHaveLength(1)
    expect(seededMergeLogs[0]).toMatchObject({
      sourceCartId: PROPOSAL_ID,
      targetCartId: 'cart-target',
      strategy: 'manual',
      proposalCartId: PROPOSAL_ID,
    })
    const outcome = seededMergeLogs[0].outcome as Array<Record<string, unknown>>
    expect(outcome).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceLineId: 'proposal-line-1', disposition: 'merged' }),
        expect.objectContaining({ sourceLineId: 'proposal-line-2', targetLineId: null, disposition: 'declined' }),
      ]),
    )

    const proposal = seededCarts.find((row) => row.id === PROPOSAL_ID)!
    expect(proposal.status).toBe('merged')
    expect(proposal.mergedIntoCartId).toBe('cart-target')
    expect(proposal.resolvedAt).not.toBeNull()

    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.cart.merged',
      expect.objectContaining({
        sourceCartId: PROPOSAL_ID,
        targetCartId: 'cart-target',
        kind: 'proposal',
        strategy: 'manual',
        proposalCartId: PROPOSAL_ID,
      }),
    )
  })

  it('refuses a locked target with 423 cart_locked, carrying its checkoutSessionId (TC-CART-PROP-14)', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', status: 'locked', checkoutSessionId: 'session-1' }),
      makeProposalFixture(),
    ]
    seededCartLines = [makeLineFixture({ id: 'proposal-line-1', cartId: PROPOSAL_ID, productId: 'product-1', quantity: '1' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await expectReject(() =>
      handler.execute(
        {
          targetCartId: 'cart-target',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          proposalCartId: PROPOSAL_ID,
          lines: [{ proposalLineId: 'proposal-line-1', accepted: true }],
          routeContext: makeRouteContext(),
        } as CartMergeInput,
        ctx,
      ),
    )
    expect(isCrudHttpError(err)).toBe(true)
    expect((err as { status: number }).status).toBe(423)
    expect((err as { body: FakeRow }).body.checkoutSessionId).toBe('session-1')
  })

  it('refuses a non-active target with 409 cart_not_active', async () => {
    seededCarts = [makeCartFixture({ id: 'cart-target', status: 'converted' }), makeProposalFixture()]
    seededCartLines = [makeLineFixture({ id: 'proposal-line-1', cartId: PROPOSAL_ID, productId: 'product-1', quantity: '1' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await expectReject(() =>
      handler.execute(
        {
          targetCartId: 'cart-target',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          proposalCartId: PROPOSAL_ID,
          lines: [{ proposalLineId: 'proposal-line-1', accepted: true }],
          routeContext: makeRouteContext(),
        } as CartMergeInput,
        ctx,
      ),
    )
    expect(isCrudHttpError(err)).toBe(true)
    expect((err as { status: number; body: FakeRow }).status).toBe(409)
    expect((err as { body: FakeRow }).body.code).toBe('cart_not_active')
  })

  it('refuses a non-active (already resolved) proposal with 409 cart_not_active', async () => {
    seededCarts = [makeCartFixture({ id: 'cart-target' }), makeProposalFixture({ status: 'expired' })]
    seededCartLines = [makeLineFixture({ id: 'proposal-line-1', cartId: PROPOSAL_ID, productId: 'product-1', quantity: '1' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await expectReject(() =>
      handler.execute(
        {
          targetCartId: 'cart-target',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          proposalCartId: PROPOSAL_ID,
          lines: [{ proposalLineId: 'proposal-line-1', accepted: true }],
          routeContext: makeRouteContext(),
        } as CartMergeInput,
        ctx,
      ),
    )
    expect(isCrudHttpError(err)).toBe(true)
    expect((err as { status: number; body: FakeRow }).status).toBe(409)
    expect((err as { body: FakeRow }).body.code).toBe('cart_not_active')
  })

  it('404s when the proposal id does not belong to this target', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target' }),
      makeCartFixture({ id: 'other-target' }),
      makeProposalFixture({ proposedToCartId: 'other-target' }),
    ]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await expectReject(() =>
      handler.execute(
        {
          targetCartId: 'cart-target',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          proposalCartId: PROPOSAL_ID,
          lines: [],
          routeContext: makeRouteContext(),
        } as CartMergeInput,
        ctx,
      ),
    )
    expect(isCrudHttpError(err)).toBe(true)
    expect((err as { status: number }).status).toBe(404)
  })

  it('400s when `lines` references a proposalLineId that does not belong to this proposal', async () => {
    seededCarts = [makeCartFixture({ id: 'cart-target' }), makeProposalFixture()]
    seededCartLines = [makeLineFixture({ id: 'proposal-line-1', cartId: PROPOSAL_ID, productId: 'product-1', quantity: '1' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await expectReject(() =>
      handler.execute(
        {
          targetCartId: 'cart-target',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          proposalCartId: PROPOSAL_ID,
          lines: [{ proposalLineId: 'does-not-exist', accepted: true }],
          routeContext: makeRouteContext(),
        } as CartMergeInput,
        ctx,
      ),
    )
    expect(isCrudHttpError(err)).toBe(true)
    expect((err as { status: number }).status).toBe(400)
  })

  it('422s with proposal_accept_empty when every line is declined (none accepted), and creates nothing', async () => {
    seededCarts = [makeCartFixture({ id: 'cart-target' }), makeProposalFixture()]
    seededCartLines = [makeLineFixture({ id: 'proposal-line-1', cartId: PROPOSAL_ID, productId: 'product-1', quantity: '1' })]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await expectReject(() =>
      handler.execute(
        {
          targetCartId: 'cart-target',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          proposalCartId: PROPOSAL_ID,
          lines: [{ proposalLineId: 'proposal-line-1', accepted: false }],
          routeContext: makeRouteContext(),
        } as CartMergeInput,
        ctx,
      ),
    )
    expect(isCrudHttpError(err)).toBe(true)
    expect((err as { status: number; body: FakeRow }).status).toBe(422)
    expect((err as { body: FakeRow }).body.code).toBe('proposal_accept_empty')
    expect(seededMergeLogs).toHaveLength(0)
  })

  it('re-checks visibility against the buyer\'s freshly-resolved scope and records a rejected disposition for a restricted line (TC-CART-PROP-04)', async () => {
    seededCarts = [makeCartFixture({ id: 'cart-target' }), makeProposalFixture()]
    seededCartLines = [makeLineFixture({ id: 'proposal-line-1', cartId: PROPOSAL_ID, productId: 'product-1', quantity: '1' })]
    const scopedService = {
      loadScopedProducts: jest.fn(async () => new Map([['product-1', { id: 'product-1', categoryIds: ['blocked'], tagIds: [], isActive: true }]])),
    }

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em, catalogScopedProductService: scopedService })

    const result = await handler.execute(
      {
        targetCartId: 'cart-target',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        proposalCartId: PROPOSAL_ID,
        lines: [{ proposalLineId: 'proposal-line-1', accepted: true }],
        routeContext: makeRouteContext({ assortmentScope: [{ categoryIds: ['allowed'], tagIds: [] }] }),
      } as CartMergeInput,
      ctx,
    )

    expect(result.mergeSummary.counts).toMatchObject({ rejected: 1 })
    expect(seededCartLines.find((row) => row.cartId === 'cart-target')).toBeUndefined()
  })
})

/** `commands/__tests__/lines.test.ts`'s own `captureError` convention, duplicated at this
 * file's small scope: no `jest-extended` matcher is registered, so `.rejects.toSatisfy`
 * would crash the worker on an unmatched rejection rather than failing the test cleanly. */
async function expectReject(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (err) {
    return err
  }
  throw new Error('expected the promise to reject, but it resolved')
}

// Step 3.4 (§7a.7, D-R5-25) — `cart.mergeUndo` refuses a proposal-sourced merge outright.
describe('cart.mergeUndo — D-R5-25 refuses a proposal-sourced merge acceptance', () => {
  it('refuses with 409 merge_undo_not_supported_for_proposal when the merge log names a proposalCartId, and changes nothing', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'proposal-1', kind: 'proposal', proposedToCartId: 'cart-target', status: 'merged', mergedIntoCartId: 'cart-target', resolvedAt: new Date() }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '2' })]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-proposal-1',
        sourceCartId: 'proposal-1',
        targetCartId: 'cart-target',
        strategy: 'manual',
        proposalCartId: 'proposal-1',
        outcome: [{ sourceLineId: 'proposal-line-1', targetLineId: 'line-target-1', disposition: 'merged' }],
        createdAt: new Date(Date.now() - 1 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await expectReject(() =>
      handler.execute({ cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() }, ctx),
    )
    expect(isCrudHttpError(err)).toBe(true)
    expect((err as { status: number }).status).toBe(409)
    expect((err as { body: FakeRow }).body.code).toBe('merge_undo_not_supported_for_proposal')

    // Nothing changed: the target line, the proposal cart and the merge log's own
    // `undoneAt` are all exactly as they were before this call.
    const targetLine = seededCartLines.find((row) => row.id === 'line-target-1')!
    expect(targetLine.quantity).toBe('2')
    const proposal = seededCarts.find((row) => row.id === 'proposal-1')!
    expect(proposal.status).toBe('merged')
    expect(seededMergeLogs[0].undoneAt).toBeUndefined()
    expect(emitCartEventMock).not.toHaveBeenCalledWith('cart.proposal.acceptance_undone', expect.anything())
  })

  it('a NON-proposal-sourced undo is completely unaffected (regression guard) — proposalCartId: null still restores normally', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'cart-guest', tokenHash: hashCartToken('guest-plain-token-regression'), status: 'merged', mergedIntoCartId: 'cart-target' }),
    ]
    seededCartLines = [makeLineFixture({ id: 'line-target-1', cartId: 'cart-target', productId: 'product-1', quantity: '5' })]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-ordinary-1',
        sourceCartId: 'cart-guest',
        targetCartId: 'cart-target',
        strategy: 'sum',
        proposalCartId: null,
        outcome: [{ sourceLineId: 'line-guest-1', targetLineId: 'line-target-1', disposition: 'summed', previousTargetQuantity: '2' }],
        createdAt: new Date(Date.now() - 1 * 60 * 1000),
      }),
    ]

    const handler = getUndoHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { cartId: 'cart-target', tenantId: TENANT_ID, organizationId: ORG_ID, routeContext: makeRouteContext() },
      ctx,
    )
    expect(result.cart.id).toBe('cart-target')
    const line = seededCartLines.find((row) => row.id === 'line-target-1')!
    expect(line.quantity).toBe('2')
    const guestCart = seededCarts.find((row) => row.id === 'cart-guest')!
    expect(guestCart.status).toBe('active')
  })

  it('the generic command-undo-log handler (admin "Undo" action) silently no-ops for a proposal-sourced merge too, rather than erroring', async () => {
    seededCarts = [
      makeCartFixture({ id: 'cart-target', tokenHash: 'target-token-hash' }),
      makeCartFixture({ id: 'proposal-1', kind: 'proposal', proposedToCartId: 'cart-target', status: 'merged', mergedIntoCartId: 'cart-target', resolvedAt: new Date() }),
    ]
    seededMergeLogs = [
      makeMergeLogFixture({
        id: 'merge-log-proposal-2',
        sourceCartId: 'proposal-1',
        targetCartId: 'cart-target',
        strategy: 'manual',
        proposalCartId: 'proposal-1',
        outcome: [],
        createdAt: new Date(Date.now() - 1 * 60 * 1000),
      }),
    ]

    const handler = getMergeHandler()
    const em = makeEm()
    const ctx = makeCtx({ em })
    const logEntry = {
      commandPayload: { undo: { mergeLogId: 'merge-log-proposal-2' } },
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    }

    // No throw — the generic undo-log path has no HTTP consumer to show a 409 to, so it
    // silently no-ops exactly like the already-undone/not-active cases it already swallowed.
    await expect(handler.undo!({ logEntry, ctx } as any)).resolves.toBeUndefined()
  })
})
