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
let seededCartLines: FakeRow[] = []

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === CartLine) return seededCartLines.find((row) => matchesWhere(row, where)) ?? null
  return seededCarts.find((row) => matchesWhere(row, where)) ?? null
})

const mockFindWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === CartLine) return seededCartLines.filter((row) => matchesWhere(row, where))
  if (entity === Cart) return seededCarts.filter((row) => matchesWhere(row, where))
  return []
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Cart, CartLine, CartPromotionApplication } from '../../data/entities'
import type { ResolvedCartRouteContext } from '../../lib/routeContext'
import { resolveCartLockTimeoutMs } from '../../lib/sweepConfig'
import { emitCartEvent as mockedEmitCartEvent } from '../../events'
import { repriceCartCommand } from '../cart'
import type { CartRepriceInput, CartRepriceResult } from '../cart'
import type {
  CartLockInput,
  CartLockResult,
  CartMarkConvertedInput,
  CartMarkConvertedResult,
  CartUnlockInput,
  CartUnlockResult,
} from '../lock'
import '../lock'

const emitCartEventMock = mockedEmitCartEvent as jest.Mock

const TENANT_ID = 'tenant-lock-1'
const ORG_ID = 'org-lock-1'
const CART_ID = 'cart-1'

function makeRouteContext(overrides: Partial<ResolvedCartRouteContext> = {}): ResolvedCartRouteContext {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: 'store-1',
    channel: 'storefront',
    assortmentScope: null,
    buyerDigest: 'digest-1',
    customerId: null,
    customerIds: [],
    customerGroupIds: [],
    customerUserId: null,
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
    id: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    tokenHash: 'seeded-token-hash',
    storeId: null,
    // Non-storefront by default: `shouldEnforceAssortmentScope` only enforces for a
    // storefront cart or an explicitly-resolved scope, so most of these tests (which never
    // supply a `routeContext`) stay clear of the §6a.2 re-visibility pass entirely — only
    // the dedicated 409 test below opts into a storefront channel + scope.
    channel: 'pos',
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
    buyerDigest: 'digest-1',
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
    resolvedAt: null,
    expiresAt: new Date('2026-03-08T00:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeLineFixture(overrides: FakeRow = {}): FakeRow {
  const now = new Date('2026-03-01T00:00:00.000Z')
  return {
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
    quantity: '2',
    quantityUnit: null,
    unitPriceNet: '10',
    unitPriceGross: '12',
    taxRate: '20',
    priceKindId: null,
    priceRowId: 'price-row-1',
    priceTierMinQuantity: 1,
    pricedAt: now,
    lineTotals: { subtotalNetAmount: 20, subtotalGrossAmount: 24, discountTotalAmount: 0, taxTotalAmount: 4, grandTotalNetAmount: 20, grandTotalGrossAmount: 24 },
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

function makeEm() {
  const em: any = {
    fork: jest.fn(),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    create: jest.fn((_ctor: unknown, data: FakeRow) => ({ id: `generated-${Math.random().toString(36).slice(2)}`, ...data })),
    persist: jest.fn(),
    remove: jest.fn(),
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

function makeResolvedLinePrice(overrides: FakeRow = {}) {
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

function makeSalesCalculationService() {
  return {
    calculateLine: jest.fn(async ({ line }: any) => ({
      line,
      netAmount: Number(line.quantity) * (line.unitPriceNet ?? 0),
      grossAmount: Number(line.quantity) * (line.unitPriceGross ?? 0),
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
        subtotalNetAmount: 20,
        subtotalGrossAmount: 24,
        discountTotalAmount: 0,
        taxTotalAmount: 4,
        grandTotalNetAmount: 20,
        grandTotalGrossAmount: 24,
      },
      metadata: {},
    })),
  }
}

/** Resolves `cart.reprice` by calling the REAL registered handler directly — same
 * precedent `commands/__tests__/cart.test.ts`'s own `makeFakeCommandBus` already
 * establishes for `cart.get`'s identical internal-dispatch shape. */
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
  dataEngine?: unknown
  commandBus?: unknown
  catalogBuyerPricingService?: unknown
  salesCalculationService?: unknown
  promotionsService?: unknown
  catalogScopedProductService?: unknown
  // Step 3.1 (K1-K5) — undefined by default, matching every DI token this fake container
  // did not already know before this Step: `cart.reprice`'s totals phase defensively
  // `tryResolve`s `customerGroupsService` (`lib/approvalGate.ts`), so the EXISTING tests
  // above (none of which pass this) keep getting the `Unexpected DI token` throw, caught
  // internally, degrading to `requiresApproval: false` exactly as before this Step.
  customerGroupsService?: unknown
  customerPurchaseApprovalService?: unknown
  // Step 6.1 (K11 gap-fill) — same "undefined degrades via Unexpected DI token" shape as
  // `customerPurchaseApprovalService` above, caught by `tryResolveCartCodeService`.
  promotionCodeService?: unknown
}): CommandRuntimeContext {
  const dataEngine = opts.dataEngine ?? makeDataEngine()
  const salesCalculationService = opts.salesCalculationService ?? makeSalesCalculationService()
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return opts.em
        if (token === 'dataEngine') return dataEngine
        if (token === 'commandBus') return opts.commandBus ?? makeFakeCommandBus()
        if (token === 'catalogBuyerPricingService') {
          return opts.catalogBuyerPricingService ?? { resolveLinePrice: jest.fn(async () => makeResolvedLinePrice()) }
        }
        if (token === 'salesCalculationService') return salesCalculationService
        if (token === 'promotionsService') return opts.promotionsService ?? { evaluate: jest.fn(async () => ({ appliedPromotions: [] })) }
        if (token === 'catalogScopedProductService') return opts.catalogScopedProductService ?? makeDefaultCatalogScopedProductService()
        if (token === 'customerGroupsService') {
          if (opts.customerGroupsService !== undefined) return opts.customerGroupsService
          throw new Error(`Unexpected DI token: ${token}`)
        }
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

function getHandler<I, R>(id: string): CommandHandler<I, R> {
  const handler = commandRegistry.get<I, R>(id)
  if (!handler) throw new Error(`command ${id} not registered`)
  return handler
}

beforeEach(() => {
  jest.clearAllMocks()
  seededCarts = [makeCartFixture()]
  seededCartLines = []
})

describe('cart.lock', () => {
  it('succeeds on a clean cart: sets status/lockedAt/lockExpiresAt/checkoutSessionId, and dispatches cart.reprice with trigger "lock"', async () => {
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const commandBus = makeFakeCommandBus()
    const ctx = makeCtx({ em, commandBus })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' },
      ctx,
    )

    expect(result.cart.status).toBe('locked')
    expect(result.cart.checkoutSessionId).toBe('checkout-session-1')
    expect(result.cart.lockedAt).toBeInstanceOf(Date)
    expect(result.cart.lockExpiresAt).toBeInstanceOf(Date)
    expect(result.cart.lockExpiresAt!.getTime() - result.cart.lockedAt!.getTime()).toBe(resolveCartLockTimeoutMs())

    const cartRow = seededCarts.find((row) => row.id === CART_ID)!
    expect(cartRow.status).toBe('locked')
    expect(cartRow.checkoutSessionId).toBe('checkout-session-1')

    const repriceCalls = (commandBus.execute as jest.Mock).mock.calls.filter(([id]) => id === 'cart.reprice')
    expect(repriceCalls).toHaveLength(1)
    expect((repriceCalls[0][1] as { input: CartRepriceInput }).input.trigger).toBe('lock')

    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.lock.acquired',
      expect.objectContaining({ cartId: CART_ID, checkoutSessionId: 'checkout-session-1' }),
    )
  })

  // Release 5 Phase 4 (checkout C2, §6a.1a): deferred by Step 2.8/2.9 "until a real caller
  // exists" — checkout (Step 4.1) is that caller, so this is now enforced for real.
  it('refuses with 400 assortment_scope_required_for_storefront_channel when a storefront cart is locked without a routeContext', async () => {
    seededCarts = [makeCartFixture({ channel: 'storefront' })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const commandBus = makeFakeCommandBus()
    const ctx = makeCtx({ em, commandBus })

    let captured: unknown
    try {
      await handler.execute(
        { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(400)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({
      code: 'assortment_scope_required_for_storefront_channel',
    })
    // A refusal, not a partial commit — the cart must still be active, and `cart.reprice`
    // (which would otherwise run first) must never have been dispatched.
    expect(seededCarts.find((row) => row.id === CART_ID)!.status).toBe('active')
    expect((commandBus.execute as jest.Mock).mock.calls.filter(([id]) => id === 'cart.reprice')).toHaveLength(0)
  })

  it('succeeds on a storefront cart when a routeContext IS supplied', async () => {
    seededCarts = [makeCartFixture({ channel: 'storefront' })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const commandBus = makeFakeCommandBus()
    const ctx = makeCtx({ em, commandBus })

    const result = await handler.execute(
      {
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        checkoutSessionId: 'checkout-session-1',
        routeContext: makeRouteContext(),
      },
      ctx,
    )

    expect(result.cart.status).toBe('locked')
  })

  // Documented mechanics (Step 7.5): after the forced re-price dispatch settles, `cart.lock`
  // re-reads every non-deleted `CartLine` and refuses with 409 if ANY carries a non-null
  // `flag_state` — exercised here by letting §6a.2's whole-cart re-visibility pass (gated to
  // `trigger: 'lock'` by this step's own extension of `commands/cart.ts`) actually flag a
  // line, rather than pre-seeding `flagState` directly (which `cart.reprice`'s own
  // re-visibility pass could otherwise just as easily clear again before `cart.lock` ever
  // gets to check).
  it('refuses with 409 cart_has_unavailable_lines when a line is flagged after the forced re-price', async () => {
    seededCarts = [makeCartFixture({ channel: 'storefront' })]
    seededCartLines = [makeLineFixture()]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const catalogScopedProductService = {
      // product-1's category does not match the restrictive scope below.
      loadScopedProducts: jest.fn(async () => new Map([['product-1', { id: 'product-1', categoryIds: ['cat-wholesale'], tagIds: [], isActive: true }]])),
    }
    const ctx = makeCtx({ em, catalogScopedProductService })

    const routeContext = makeRouteContext({ assortmentScope: [{ categoryIds: ['cat-retail'] }] as any })

    let captured: unknown
    try {
      await handler.execute(
        { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1', routeContext },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'cart_has_unavailable_lines' })
    // The cart must NOT have been locked — the 409 is a refusal, not a partial commit.
    expect(seededCarts.find((row) => row.id === CART_ID)!.status).toBe('active')
    expect(seededCartLines[0].flagState).toBe('product_unavailable')
  })

  it('refuses a re-lock attempt against an already-locked cart with 423 cart_locked, not a generic error', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'existing-session' })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'new-session' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'cart_locked', checkoutSessionId: 'existing-session' })
  })

  // (C1) Regression guard: this step changes NOTHING about a re-lock from a different (or
  // absent) checkoutSessionId — only the SAME-session case below is new. Exercises the
  // no-session variant specifically, since the named test above only covers "different".
  it('still refuses a re-lock attempt with NO checkoutSessionId at all against an already-locked cart with 423', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'existing-session' })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: undefined as unknown as string },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(423)
  })

  it('refuses locking a non-active, non-locked cart with the generic 404', async () => {
    seededCarts = [makeCartFixture({ status: 'abandoned' })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  it('rejects an out-of-bounds lockTtlMs with a 400, before touching the cart at all', async () => {
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1', lockTtlMs: 1_000 },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(400)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'invalid_lock_ttl_ms' })
    // Never even loaded the cart via the pre-check path's lock/status logic.
    expect(seededCarts.find((row) => row.id === CART_ID)!.status).toBe('active')
  })

  it('a fresh lock with an explicit lockTtlMs honours it instead of the env default', async () => {
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const commandBus = makeFakeCommandBus()
    const ctx = makeCtx({ em, commandBus })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1', lockTtlMs: 120_000 },
      ctx,
    )

    expect(result.extended).toBe(false)
    expect(result.cart.lockExpiresAt!.getTime() - result.cart.lockedAt!.getTime()).toBe(120_000)
  })

  describe('idempotent extend (C1/X15)', () => {
    it('a second lock with the SAME checkoutSessionId on a locked cart extends lockExpiresAt and returns the cart, with extended: true', async () => {
      const lockedAt = new Date('2026-03-01T00:00:00.000Z')
      const originalExpiry = new Date('2026-03-01T00:30:00.000Z')
      seededCarts = [
        makeCartFixture({ status: 'locked', lockedAt, lockExpiresAt: originalExpiry, checkoutSessionId: 'checkout-session-1' }),
      ]
      const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
      const em = makeEm()
      const commandBus = makeFakeCommandBus()
      const ctx = makeCtx({ em, commandBus })

      const result = await handler.execute(
        { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1', lockTtlMs: 600_000 },
        ctx,
      )

      expect(result.extended).toBe(true)
      expect(result.cart.status).toBe('locked')
      expect(result.cart.checkoutSessionId).toBe('checkout-session-1')
      expect(result.priceChanges).toEqual([])
      expect(result.cart.lockExpiresAt!.getTime()).toBeGreaterThan(originalExpiry.getTime())
      expect(result.cart.lockExpiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(600_000)
      expect(result.cart.lockExpiresAt!.getTime() - Date.now()).toBeGreaterThan(600_000 - 5_000)

      const cartRow = seededCarts.find((row) => row.id === CART_ID)!
      expect(cartRow.lockExpiresAt.getTime()).toBe(result.cart.lockExpiresAt!.getTime())
      // `lockedAt` itself is untouched by an extend — only `lockExpiresAt` moves.
      expect(cartRow.lockedAt).toEqual(lockedAt)

      // The core guarantee this test exists to prove: an extend re-runs NEITHER the re-price
      // NOR the visibility pass — `cart.reprice` is never dispatched a second time.
      expect((commandBus.execute as jest.Mock).mock.calls.filter(([id]) => id === 'cart.reprice')).toHaveLength(0)

      expect(emitCartEventMock).toHaveBeenCalledWith(
        'cart.lock.extended',
        expect.objectContaining({ cartId: CART_ID, checkoutSessionId: 'checkout-session-1' }),
      )
      expect(emitCartEventMock).not.toHaveBeenCalledWith('cart.lock.acquired', expect.anything())
    })

    it('an extend with no explicit lockTtlMs falls back to the existing env default, same as a fresh lock', async () => {
      seededCarts = [
        makeCartFixture({ status: 'locked', lockedAt: new Date(), lockExpiresAt: new Date(), checkoutSessionId: 'checkout-session-1' }),
      ]
      const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
      const em = makeEm()
      const ctx = makeCtx({ em })

      const before = Date.now()
      const result = await handler.execute(
        { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' },
        ctx,
      )

      expect(result.extended).toBe(true)
      const delta = result.cart.lockExpiresAt!.getTime() - before
      expect(delta).toBeGreaterThan(resolveCartLockTimeoutMs() - 5_000)
      expect(delta).toBeLessThanOrEqual(resolveCartLockTimeoutMs() + 5_000)
    })

    it('rejects an out-of-bounds lockTtlMs on an extend too', async () => {
      seededCarts = [
        makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' }),
      ]
      const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
      const em = makeEm()
      const ctx = makeCtx({ em })

      let captured: unknown
      try {
        await handler.execute(
          { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1', lockTtlMs: 999_999_999 },
          ctx,
        )
      } catch (err) {
        captured = err
      }

      expect(isCrudHttpError(captured)).toBe(true)
      expect((captured as { status: number }).status).toBe(400)
      expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'invalid_lock_ttl_ms' })
    })
  })
})

// Step 3.1 (K1-K5, D-R5-4/12/23/29/37) — the approval gate inside `cart.lock`. Every test
// here stubs `customerGroupsService`/`customerPurchaseApprovalService` directly (the fake
// DI container throws `Unexpected DI token` for either when a test omits them, matching
// the pre-Step-3.1 tests above) rather than exercising the real `resolveTerms`/base-
// currency chain, which `customer_groups/__tests__/resolveTerms.test.ts` already covers on
// its own. `makeSalesCalculationService()`'s default `calculateDocumentTotals` returns
// `grandTotalGrossAmount: 24` — every threshold below is chosen relative to that fixed
// goods-gross figure.
describe('cart.lock — approval gate (K1-K5, D-R5-4/12/23/29/37)', () => {
  function makeCustomerGroupsServiceStub(overrides: {
    approvalRequiredAbove?: number | null
    termsCurrencyCode?: string | null
  } = {}) {
    return {
      resolveGroups: jest.fn(async () => ({ groupIds: [], groups: [] })),
      resolveTerms: jest.fn(async () => ({
        priceKindId: null,
        paymentTermsDays: null,
        allowPurchaseOnAccount: false,
        approvalRequiredAbove: overrides.approvalRequiredAbove === undefined ? 100 : overrides.approvalRequiredAbove,
        minOrderValue: null,
        approvalPolicy: 'buyer',
        // `??` would treat an EXPLICIT `null` (the fail-closed test case below) the same
        // as "not provided" — only default when the caller omitted the key entirely.
        termsCurrencyCode: overrides.termsCurrencyCode === undefined ? 'USD' : overrides.termsCurrencyCode,
        sources: {
          priceKindId: null,
          paymentTermsDays: null,
          allowPurchaseOnAccount: null,
          approvalRequiredAbove: null,
          minOrderValue: null,
          approvalPolicy: null,
          termsCurrencyCode: null,
        },
      })),
      resolveAssortmentScope: jest.fn(async () => ({ scope: {}, sourceGroupIds: [], sourceCustomerOverrideId: null })),
    }
  }

  function makeApprovalServiceStub(approval: FakeRow | null) {
    return {
      requestApproval: jest.fn(),
      getApproval: jest.fn(async () => approval),
      getActiveApprovalForSubject: jest.fn(),
      withdrawApproval: jest.fn(),
      decideApproval: jest.fn(),
    }
  }

  // TC-CART-APR-02
  it('refuses with 409 cart_requires_approval when the gate is above threshold and no approval exists', async () => {
    seededCarts = [makeCartFixture({ customerUserId: 'buyer-1', customerIds: ['buyer-1'], approvalId: null })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub({ approvalRequiredAbove: 10 })
    const ctx = makeCtx({ em, customerGroupsService })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'cart_requires_approval', approval: null })
    expect(seededCarts.find((row) => row.id === CART_ID)!.status).toBe('active')
  })

  // TC-CART-APR-03
  it('allows the lock when a qualifying approval covers the current goods gross', async () => {
    seededCarts = [makeCartFixture({ customerUserId: 'buyer-1', customerIds: ['buyer-1'], approvalId: 'approval-1' })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub({ approvalRequiredAbove: 10 })
    const customerPurchaseApprovalService = makeApprovalServiceStub({
      id: 'approval-1',
      status: 'approved',
      currencyCode: 'USD',
      amountGross: '24',
    })
    const ctx = makeCtx({ em, customerGroupsService, customerPurchaseApprovalService })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' },
      ctx,
    )

    expect(result.cart.status).toBe('locked')
    expect(customerPurchaseApprovalService.getApproval).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      approvalId: 'approval-1',
    })
  })

  // TC-CART-APR-04 (K1/D-R5-3 "only a higher total invalidates")
  it('refuses the lock when the goods gross has risen above the approved amount, even with an existing approval', async () => {
    seededCarts = [makeCartFixture({ customerUserId: 'buyer-1', customerIds: ['buyer-1'], approvalId: 'approval-1' })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub({ approvalRequiredAbove: 10 })
    const customerPurchaseApprovalService = makeApprovalServiceStub({
      id: 'approval-1',
      status: 'approved',
      currencyCode: 'USD',
      amountGross: '20',
    })
    const ctx = makeCtx({ em, customerGroupsService, customerPurchaseApprovalService })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({
      code: 'cart_requires_approval',
      approval: { id: 'approval-1', status: 'approved', currencyCode: 'USD', amountGross: '20' },
    })
  })

  // TC-CART-APR-05a (D-R5-4/D-R5-37 fail-closed: no usable currency at all)
  it('is fail-closed when termsCurrencyCode cannot be resolved, even for a goods gross below the threshold', async () => {
    seededCarts = [makeCartFixture({ customerUserId: 'buyer-1', customerIds: ['buyer-1'], approvalId: null })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    // Goods gross (24) is well below the threshold (1000) — a currency-matched read would
    // never require approval. `termsCurrencyCode: null` (no group set one AND the
    // organization has no base currency, D-R5-37) means the comparison cannot be made, so
    // §9a.2's "currency mismatch" branch forces `requiresApproval = true` regardless.
    const customerGroupsService = makeCustomerGroupsServiceStub({ approvalRequiredAbove: 1000, termsCurrencyCode: null })
    const ctx = makeCtx({ em, customerGroupsService })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'cart_requires_approval' })
  })

  // TC-CART-APR-05b (D-R5-37 success path: the base-currency fallback resolved and matches)
  it('passes when termsCurrencyCode resolves (via the base-currency fallback) to the same currency as the cart', async () => {
    seededCarts = [makeCartFixture({ customerUserId: 'buyer-1', customerIds: ['buyer-1'], approvalId: null })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub({ approvalRequiredAbove: 1000, termsCurrencyCode: 'USD' })
    const ctx = makeCtx({ em, customerGroupsService })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' },
      ctx,
    )

    expect(result.cart.status).toBe('locked')
  })

  // TC-CART-APR-06 (D-R5-12 guest fail-closed, distinct refusal from cart_requires_approval)
  it('refuses a guest cart over the threshold with 409 approval_requires_identified_buyer, not cart_requires_approval', async () => {
    seededCarts = [makeCartFixture({ customerUserId: null, approvalId: null })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub({ approvalRequiredAbove: 10 })
    const ctx = makeCtx({ em, customerGroupsService })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'approval_requires_identified_buyer' })
  })

  // TC-CART-APR-07 (D-R5-23: purpose: 'quote' skips the gate entirely)
  it('a purpose: "quote" lock skips the gate even for a guest cart over the threshold', async () => {
    seededCarts = [makeCartFixture({ customerUserId: null, approvalId: null })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    const customerGroupsService = makeCustomerGroupsServiceStub({ approvalRequiredAbove: 10 })
    const ctx = makeCtx({ em, customerGroupsService })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1', purpose: 'quote' },
      ctx,
    )

    expect(result.cart.status).toBe('locked')
  })

  // TC-CART-APR-08 (D-R5-29: no channel exemption)
  it.each(['pay_link', 'api', 'agent'] as const)(
    'applies the SAME gate to a %s-channel cart as to a storefront cart (no channel exemption)',
    async (channel) => {
      seededCarts = [makeCartFixture({ channel, customerUserId: 'buyer-1', customerIds: ['buyer-1'], approvalId: null })]
      const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
      const em = makeEm()
      const customerGroupsService = makeCustomerGroupsServiceStub({ approvalRequiredAbove: 10 })
      const ctx = makeCtx({ em, customerGroupsService })

      let captured: unknown
      try {
        await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' }, ctx)
      } catch (err) {
        captured = err
      }

      expect(isCrudHttpError(captured)).toBe(true)
      expect((captured as { status: number }).status).toBe(409)
      expect((captured as { body?: Record<string, unknown> }).body).toMatchObject({ code: 'cart_requires_approval' })
    },
  )

  // TC-CART-APR-09 (documented degrade: `customer_groups` absent -> requiresApproval always
  // false, never a thrown error and never a gate nobody can check)
  it('locks successfully when customerGroupsService cannot be resolved at all (customer_groups absent)', async () => {
    seededCarts = [makeCartFixture({ customerUserId: 'buyer-1', customerIds: ['buyer-1'], approvalId: null })]
    const handler = getHandler<CartLockInput, CartLockResult>('cart.lock')
    const em = makeEm()
    // No `customerGroupsService` passed to `makeCtx` — the fake container throws
    // `Unexpected DI token`, caught by `tryResolveCustomerGroupsService`.
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' },
      ctx,
    )

    expect(result.cart.status).toBe('locked')
    expect(result.cart.requiresApproval).toBe(false)
  })
})

describe('cart.unlock', () => {
  it('clears the lock columns and restores status to active', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', lockedAt: new Date('2026-03-01T00:00:00.000Z'), lockExpiresAt: new Date('2026-03-01T00:30:00.000Z'), checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartUnlockInput, CartUnlockResult>('cart.unlock')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(result.cart.status).toBe('active')
    expect(result.cart.lockedAt).toBeNull()
    expect(result.cart.lockExpiresAt).toBeNull()
    expect(result.cart.checkoutSessionId).toBeNull()

    const cartRow = seededCarts.find((row) => row.id === CART_ID)!
    expect(cartRow.status).toBe('active')
    expect(cartRow.lockedAt).toBeNull()
    expect(cartRow.lockExpiresAt).toBeNull()
    expect(cartRow.checkoutSessionId).toBeNull()

    expect(emitCartEventMock).toHaveBeenCalledWith('cart.lock.released', expect.objectContaining({ cartId: CART_ID }))
  })

  it('refuses to unlock a cart that is not currently locked with the generic 404', async () => {
    seededCarts = [makeCartFixture({ status: 'active' })]
    const handler = getHandler<CartUnlockInput, CartUnlockResult>('cart.unlock')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  // (C1) A matching checkoutSessionId unlocks exactly like the no-session call shape above.
  it('with a matching checkoutSessionId: clears the lock columns and restores status to active', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartUnlockInput, CartUnlockResult>('cart.unlock')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' },
      ctx,
    )

    expect(result.cart.status).toBe('active')
    expect(result.cart.checkoutSessionId).toBeNull()
  })

  // (C1) A stale/mismatched checkoutSessionId cannot unlock a cart another session holds —
  // uniform 404, same body a non-existent cart would get, so the response discloses nothing.
  it('with a mismatched checkoutSessionId: refuses with the uniform 404, leaving the cart locked', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartUnlockInput, CartUnlockResult>('cart.unlock')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'someone-elses-session' },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
    expect(seededCarts.find((row) => row.id === CART_ID)!.status).toBe('locked')
  })
})

describe('cart.markConverted', () => {
  it('sets status to converted and stamps resolvedAt', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(result.cart.status).toBe('converted')
    expect(result.cart.resolvedAt).toBeInstanceOf(Date)

    const cartRow = seededCarts.find((row) => row.id === CART_ID)!
    expect(cartRow.status).toBe('converted')
    expect(cartRow.resolvedAt).toBeInstanceOf(Date)

    expect(emitCartEventMock).toHaveBeenCalledWith('cart.cart.converted', expect.objectContaining({ cartId: CART_ID }))
  })

  // Terminal (§3.1a: "no command mutates a converted cart"): a second `cart.markConverted`
  // call against an already-converted cart is refused with the SAME generic 404 every other
  // non-locked status gets — there is no dedicated "already converted" signal in §15a's
  // error-code catalogue, so this is the documented judgment call for what "refused" means
  // here (see `commands/lock.ts`'s own comment on `markConvertedCommand`).
  it('is terminal: a second call against an already-converted cart is refused with the generic 404', async () => {
    seededCarts = [makeCartFixture({ status: 'converted', resolvedAt: new Date('2026-03-01T00:00:00.000Z') })]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  it('refuses converting a cart that is not currently locked with the generic 404', async () => {
    seededCarts = [makeCartFixture({ status: 'active' })]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  // (C1) A matching checkoutSessionId converts exactly like the no-session call shape above.
  it('with a matching checkoutSessionId: sets status to converted and stamps resolvedAt', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'checkout-session-1' },
      ctx,
    )

    expect(result.cart.status).toBe('converted')
    expect(result.cart.resolvedAt).toBeInstanceOf(Date)
  })

  // (C1) A stale/mismatched checkoutSessionId cannot convert a cart another session holds —
  // uniform 404, so a race loser (or an attacker guessing the cart id) learns nothing.
  it('with a mismatched checkoutSessionId: refuses with the uniform 404, leaving the cart locked', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'someone-elses-session' },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
    expect(seededCarts.find((row) => row.id === CART_ID)!.status).toBe('locked')
  })

  // Step 2.10 (K8/D-R5-26, §9.1/§11) — backward-compat regression guard: a caller that
  // names NEITHER `salesOrderId` NOR `salesQuoteId` NOR `lineMap` behaves EXACTLY as before
  // this Step — the event payload still grows additively (checkoutSessionId is always
  // included now, per §11's literal shape), but no validation runs and the write succeeds
  // identically to the pre-Release-5 call shape already covered above.
  it('(K8/D-R5-26) with neither salesOrderId/salesQuoteId/lineMap: behaves exactly as before, and the converted payload carries null ids/map', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(result.cart.status).toBe('converted')
    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.cart.converted',
      expect.objectContaining({
        cartId: CART_ID,
        checkoutSessionId: 'checkout-session-1',
        salesOrderId: null,
        salesQuoteId: null,
        lineMap: null,
      }),
    )
  })

  // (K8, the order outcome) `salesOrderId` + a `salesOrderLineId`-shaped `lineMap` covering
  // every live line emits the additive payload verbatim.
  it('(K8) with salesOrderId + an order-shaped lineMap covering every live line: emits the additive payload', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    seededCartLines = [
      { id: 'line-1', cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
      { id: 'line-2', cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
    ]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const lineMap = [
      { cartLineId: 'line-1', salesOrderLineId: 'order-line-1' },
      { cartLineId: 'line-2', salesOrderLineId: 'order-line-2' },
    ]
    const result = await handler.execute(
      {
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        salesOrderId: 'order-1',
        lineMap,
      },
      ctx,
    )

    expect(result.cart.status).toBe('converted')
    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.cart.converted',
      expect.objectContaining({ cartId: CART_ID, salesOrderId: 'order-1', salesQuoteId: null, lineMap }),
    )
  })

  // (D-R5-26, the quote outcome) `salesQuoteId` + a `salesQuoteLineId`-shaped `lineMap`
  // emits the additive payload with `salesOrderId: null`.
  it('(D-R5-26) with salesQuoteId + a quote-shaped lineMap covering every live line: emits the additive payload', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    seededCartLines = [{ id: 'line-1', cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const lineMap = [{ cartLineId: 'line-1', salesQuoteLineId: 'quote-line-1' }]
    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, salesQuoteId: 'quote-1', lineMap },
      ctx,
    )

    expect(result.cart.status).toBe('converted')
    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.cart.converted',
      expect.objectContaining({ cartId: CART_ID, salesOrderId: null, salesQuoteId: 'quote-1', lineMap }),
    )
  })

  // (D-R5-26) never both ids in the same call — refused before anything is written.
  it('(D-R5-26) refuses a call naming BOTH salesOrderId and salesQuoteId, and writes nothing', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, salesOrderId: 'order-1', salesQuoteId: 'quote-1' },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(400)
    expect(seededCarts.find((row) => row.id === CART_ID)!.status).toBe('locked')
    expect(emitCartEventMock).not.toHaveBeenCalledWith('cart.cart.converted', expect.anything())
  })

  // (§9.1 "Every cartLineId must be a live line of the cart") a map naming a line that is
  // not a live line of this cart is malformed — refused, nothing written.
  it('refuses a lineMap entry naming a cartLineId that is not a live line of this cart', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    seededCartLines = [{ id: 'line-1', cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        {
          cartId: CART_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          salesOrderId: 'order-1',
          lineMap: [{ cartLineId: 'not-a-real-line', salesOrderLineId: 'order-line-1' }],
        },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(400)
  })

  // (§9.1 "every customer line must appear exactly once") a map missing one of the cart's
  // two live lines is malformed — refused, nothing written.
  it("refuses a lineMap that omits one of the cart's own live lines (incomplete bijection)", async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    seededCartLines = [
      { id: 'line-1', cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
      { id: 'line-2', cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
    ]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        {
          cartId: CART_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          salesOrderId: 'order-1',
          lineMap: [{ cartLineId: 'line-1', salesOrderLineId: 'order-line-1' }],
        },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(400)
  })

  // (D-R5-26 "never both... entries are a UNION type") a lineMap entry carrying the WRONG
  // shape for the id this call named (quote-shaped entry under an order conversion) is
  // malformed — refused.
  it('refuses a lineMap entry whose shape does not match the id this call named', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    seededCartLines = [{ id: 'line-1', cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const ctx = makeCtx({ em })

    let captured: unknown
    try {
      await handler.execute(
        {
          cartId: CART_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          salesOrderId: 'order-1',
          lineMap: [{ cartLineId: 'line-1', salesQuoteLineId: 'quote-line-1' }],
        },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(400)
  })
})

// Step 6.1 (K3/K11 gap-fill) — the two lifecycle side effects `markConverted`'s original
// Step 2.10/7.5 pass never wired: withdrawing a still-pending approval on the QUOTE outcome
// (§9a.4, mirroring `commands/merge.ts`'s source-side withdrawal), and releasing the cart's
// reserved-but-unused promotion codes by `cartId` (mirroring `lib/sweepers.ts`'s own
// expire/abandon sweeps).
describe('cart.markConverted — K3/K11 gap-fill', () => {
  it('(K3) withdraws a pending approval and clears awaitingApprovalSince when converted via the QUOTE outcome', async () => {
    seededCarts = [
      makeCartFixture({
        status: 'locked',
        checkoutSessionId: 'checkout-session-1',
        approvalId: 'approval-1',
        awaitingApprovalSince: new Date('2026-02-28T00:00:00.000Z'),
      }),
    ]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const withdrawApproval = jest.fn(async () => ({}))
    const ctx = makeCtx({ em, customerPurchaseApprovalService: { withdrawApproval } })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, salesQuoteId: 'quote-1' },
      ctx,
    )

    expect(result.cart.status).toBe('converted')
    expect(withdrawApproval).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      approvalId: 'approval-1',
      actor: { actorType: 'system', reason: 'cart_converted_as_quote' },
    })
    const cartRow = seededCarts.find((row) => row.id === CART_ID)!
    expect(cartRow.awaitingApprovalSince).toBeNull()
  })

  it('(K3 regression guard) does NOT withdraw the approval when converted via the ORDER outcome', async () => {
    seededCarts = [
      makeCartFixture({
        status: 'locked',
        checkoutSessionId: 'checkout-session-1',
        approvalId: 'approval-1',
        awaitingApprovalSince: new Date('2026-02-28T00:00:00.000Z'),
      }),
    ]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const withdrawApproval = jest.fn(async () => ({}))
    const ctx = makeCtx({ em, customerPurchaseApprovalService: { withdrawApproval } })

    const result = await handler.execute(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, salesOrderId: 'order-1' },
      ctx,
    )

    expect(result.cart.status).toBe('converted')
    expect(withdrawApproval).not.toHaveBeenCalled()
    const cartRow = seededCarts.find((row) => row.id === CART_ID)!
    expect(cartRow.awaitingApprovalSince).toEqual(new Date('2026-02-28T00:00:00.000Z'))
  })

  it('(K11) releases every distinct codeId the cart still holds on conversion', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    em.find.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CartPromotionApplication) {
        const rows = [
          { id: 'app-1', cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, codeId: 'code-1' },
          { id: 'app-2', cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, codeId: 'code-2' },
        ]
        return rows.filter((row) => matchesWhere(row, where))
      }
      return []
    })
    const releaseCode = jest.fn(async () => undefined)
    const ctx = makeCtx({ em, promotionCodeService: { releaseCode } })

    const result = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(result.cart.status).toBe('converted')
    expect(releaseCode).toHaveBeenCalledTimes(2)
    expect(releaseCode).toHaveBeenCalledWith(em, 'code-1', CART_ID, { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(releaseCode).toHaveBeenCalledWith(em, 'code-2', CART_ID, { tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('(K11) does nothing when the cart holds no code reservations', async () => {
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'checkout-session-1' })]
    const handler = getHandler<CartMarkConvertedInput, CartMarkConvertedResult>('cart.markConverted')
    const em = makeEm()
    const releaseCode = jest.fn(async () => undefined)
    const ctx = makeCtx({ em, promotionCodeService: { releaseCode } })

    const result = await handler.execute({ cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(result.cart.status).toBe('converted')
    expect(releaseCode).not.toHaveBeenCalled()
  })
})
