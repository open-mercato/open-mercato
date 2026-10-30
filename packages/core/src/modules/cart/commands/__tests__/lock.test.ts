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
import { Cart, CartLine } from '../../data/entities'
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
})
