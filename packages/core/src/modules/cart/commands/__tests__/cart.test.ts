jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../events', () => ({
  emitCartEvent: jest.fn(async () => undefined),
}))

type FakeCartRow = Record<string, unknown>

let seededCartPromotionApplications: FakeCartRow[] = []

function matchesWhere(row: FakeCartRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date) && '$in' in (value as object)) {
      return ((value as { $in: unknown[] }).$in).includes(row[key])
    }
    return row[key] === value
  })
}

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === CartLine) return seededCartLines.find((row) => matchesWhere(row, where)) ?? null
  return seededCarts.find((row) => matchesWhere(row, where)) ?? null
})

const mockFindWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === CartLine) return seededCartLines.filter((row) => matchesWhere(row, where))
  if (entity === Cart) return seededCarts.filter((row) => matchesWhere(row, where))
  if (entity === CartPromotionApplication) return seededCartPromotionApplications.filter((row) => matchesWhere(row, where))
  // `lib/reprice.ts`'s per-line `CatalogProductPrice` row fetch (and the promotions phase's
  // own `CatalogProduct`/`CatalogProductVariant` gift-line lookups) are irrelevant to these
  // command-level tests — the `catalogBuyerPricingService.resolveLinePrice` mock these tests
  // supply ignores its `rows` argument entirely, so an empty array is harmless here.
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
import { hashCartToken } from '../../lib/token'
import type { ResolvedCartRouteContext } from '../../lib/routeContext'
import { emitCartEvent as mockedEmitCartEvent } from '../../events'
import type {
  CartCreateCommandInput,
  CartCreateResult,
  CartGetInput,
  CartGetResult,
  CartRepriceInput,
  CartRepriceResult,
} from '../cart'
import { repriceCartCommand } from '../cart'
import '../cart'

const emitCartEventMock = mockedEmitCartEvent as jest.Mock

const TENANT_ID = 'tenant-cart-1'
const ORG_ID = 'org-cart-1'

let seededCarts: FakeCartRow[] = []
let seededCartLines: FakeCartRow[] = []

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

function makeEm() {
  let created: FakeCartRow | null = null
  let createCounter = 0
  const em: any = {
    fork: jest.fn(),
    find: jest.fn(async () => []),
    create: jest.fn((_ctor: unknown, data: FakeCartRow) => {
      createCounter += 1
      created = { id: `generated-id-${createCounter}`, ...data }
      return created
    }),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => undefined),
    // `cart.reprice` wraps its phases in `withAtomicFlush(em, phases, { transaction: true })`
    // (§3.1a) — these three are the minimal surface that code path needs on a fake
    // EntityManager, matching the precedent other command test suites in this codebase use
    // (e.g. `customers/commands/__tests__/deals.stage-transitions.test.ts`).
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }
  em.fork.mockReturnValue(em)
  return { em, getCreated: () => created }
}

function makeDataEngine() {
  return {
    setCustomFields: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
  }
}

function makeResolvedLinePrice(overrides: Record<string, unknown> = {}) {
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

function makeSalesCalculationService(overrides: Record<string, unknown> = {}) {
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
        subtotalNetAmount: 16,
        subtotalGrossAmount: 19.2,
        discountTotalAmount: 0,
        taxTotalAmount: 3.2,
        grandTotalNetAmount: 16,
        grandTotalGrossAmount: 19.2,
      },
      metadata: {},
    })),
    ...overrides,
  }
}

/**
 * Minimal fake `CommandBus` used by `cart.get`'s trigger-driven delegation test: resolves
 * `cart.reprice` by calling the REAL registered handler's `execute` directly, rather than
 * standing up the full `CommandBus` machinery (interceptors, audit logging, etc.) this
 * module's command tests have never needed — same reasoning `commands/claims.ts`-style
 * nested command calls use in production, just inlined for the test.
 */
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

function makeDefaultPromotionsService() {
  return { evaluate: jest.fn(async () => ({ appliedPromotions: [] })) }
}

/**
 * Step 7.4 — default-visible: every requested product resolves to an unrestricted catalog
 * record, so a test that never cares about §6a.2's whole-cart re-visibility pass does not
 * have to opt in to one. Before this step this default was dead code for `cart.test.ts`
 * (nothing here ever called `catalogScopedProductService` — only the gift-line check did,
 * and no test here exercises a promotion effect) — safe to change with no existing-test
 * impact.
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
  dataEngine: unknown
  rbacService?: unknown
  catalogBuyerPricingService?: unknown
  salesCalculationService?: unknown
  commandBus?: unknown
  promotionsService?: unknown
  catalogScopedProductService?: unknown
  auth?: CommandRuntimeContext['auth']
  selectedOrganizationId?: string | null
}): CommandRuntimeContext {
  const registerCalls: unknown[] = []
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return opts.em
        if (token === 'dataEngine') return opts.dataEngine
        if (token === 'rbacService') return opts.rbacService ?? null
        if (token === 'catalogBuyerPricingService') {
          return opts.catalogBuyerPricingService ?? { resolveLinePrice: jest.fn(async () => makeResolvedLinePrice()) }
        }
        if (token === 'salesCalculationService') return opts.salesCalculationService ?? makeSalesCalculationService()
        if (token === 'commandBus') return opts.commandBus ?? makeFakeCommandBus()
        // Step 7.1 — `cart.reprice` registers `auth` on its own container before resolving
        // this (`lib/promotions-service.ts`'s `resolvePromotionsServiceScope` convention);
        // a fake container just needs the token to resolve, never reads `auth` itself.
        if (token === 'promotionsService') return opts.promotionsService ?? makeDefaultPromotionsService()
        if (token === 'catalogScopedProductService') return opts.catalogScopedProductService ?? makeDefaultCatalogScopedProductService()
        throw new Error(`Unexpected DI token: ${token}`)
      },
      register: jest.fn((...args: unknown[]) => {
        registerCalls.push(args)
      }),
    } as any,
    auth: opts.auth ?? null,
    selectedOrganizationId: opts.selectedOrganizationId ?? null,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

function makeCartFixture(overrides: Partial<FakeCartRow> = {}): FakeCartRow {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'cart-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    tokenHash: 'seeded-token-hash',
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
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('cart.create', () => {
  afterEach(() => {
    jest.clearAllMocks()
    seededCarts = []
  })

  it('storefront path produces an active, basket-kind cart with a real token whose hash matches the persisted tokenHash', async () => {
    const handler = commandRegistry.get<CartCreateCommandInput, CartCreateResult>('cart.create')
    expect(handler).toBeDefined()

    const { em, getCreated } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const result = await handler!.execute({ routeContext: makeRouteContext() }, ctx)

    expect(result.channel).toBe('storefront')
    expect(result.token).toBeTruthy()

    const created = getCreated()
    expect(created).not.toBeNull()
    expect(created!.status).toBe('active')
    expect(created!.kind).toBe('basket')
    expect(created!.channel).toBe('storefront')
    expect(created!.tokenHash).toBe(hashCartToken(result.token))
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(1)
  })

  it('authenticated path with the matching feature succeeds for a non-storefront channel', async () => {
    const handler = commandRegistry.get<CartCreateCommandInput, CartCreateResult>('cart.create')
    const { em, getCreated } = makeEm()
    const dataEngine = makeDataEngine()
    const userHasAllFeatures = jest.fn(async () => true)
    const ctx = makeCtx({
      em,
      dataEngine,
      rbacService: { userHasAllFeatures },
      auth: { sub: 'staff-user-1', tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
    })

    const result = await handler!.execute(
      {
        channel: 'pos',
        storeId: null,
        salesChannelId: null,
        currencyCode: 'USD',
        locale: 'en-US',
        taxMode: 'gross',
        customerId: null,
        customerUserId: null,
        email: null,
      },
      ctx,
    )

    expect(result.channel).toBe('pos')
    expect(userHasAllFeatures).toHaveBeenCalledWith('staff-user-1', ['cart.channel.pos'], {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(getCreated()!.channel).toBe('pos')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('authenticated path without the matching feature is rejected and persists nothing', async () => {
    const handler = commandRegistry.get<CartCreateCommandInput, CartCreateResult>('cart.create')
    const { em, getCreated } = makeEm()
    const dataEngine = makeDataEngine()
    const userHasAllFeatures = jest.fn(async () => false)
    const ctx = makeCtx({
      em,
      dataEngine,
      rbacService: { userHasAllFeatures },
      auth: { sub: 'staff-user-1', tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
    })

    let captured: unknown
    try {
      await handler!.execute(
        {
          channel: 'pos',
          storeId: null,
          salesChannelId: null,
          currencyCode: 'USD',
          locale: 'en-US',
          taxMode: 'gross',
          customerId: null,
          customerUserId: null,
          email: null,
        },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(403)
    expect(getCreated()).toBeNull()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('cart.get', () => {
  afterEach(() => {
    jest.clearAllMocks()
    seededCarts = []
    seededCartLines = []
  })

  it('resolves a cart by id and by a re-hashed token identically', async () => {
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const plaintextToken = 'plaintext-token-value'
    const cart = makeCartFixture({ tokenHash: hashCartToken(plaintextToken) })
    seededCarts = [cart]

    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const byId = await handler!.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string }, ctx)
    const byToken = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, token: plaintextToken },
      ctx,
    )

    expect(byId.found).toBe(true)
    expect(byToken.found).toBe(true)
    if (byId.found && byToken.found) {
      expect(byId.cart).toEqual(byToken.cart)
      expect(byId.cart.id).toBe(cart.id)
      expect((byId.cart as Record<string, unknown>).tokenHash).toBeUndefined()
    }
  })

  it('returns the identical uniform not-found result for a wrong tenant, a wrong token, and a nonexistent id', async () => {
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const plaintextToken = 'plaintext-token-value-2'
    const cart = makeCartFixture({ id: 'cart-2', tokenHash: hashCartToken(plaintextToken) })
    seededCarts = [cart]

    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const wrongTenant = await handler!.execute(
      { tenantId: 'some-other-tenant', organizationId: ORG_ID, cartId: cart.id as string },
      ctx,
    )
    const wrongToken = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, token: 'not-the-right-token' },
      ctx,
    )
    const nonexistentId = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: 'does-not-exist' },
      ctx,
    )

    expect(wrongTenant).toEqual({ found: false })
    expect(wrongToken).toEqual({ found: false })
    expect(nonexistentId).toEqual({ found: false })
  })

  it('never resolves a proposal-kind cart through the basket-only lookup, by id or by token', async () => {
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const plaintextToken = 'plaintext-token-value-3'
    const proposalCart = makeCartFixture({
      id: 'cart-proposal-1',
      kind: 'proposal',
      tokenHash: hashCartToken(plaintextToken),
    })
    seededCarts = [proposalCart]

    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const byId = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: proposalCart.id as string },
      ctx,
    )
    const byToken = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, token: plaintextToken },
      ctx,
    )

    expect(byId).toEqual({ found: false })
    expect(byToken).toEqual({ found: false })
  })
})

// Step 5.1 — §5.2 triggers 2-4, evaluated inside `cart.get` whenever a `freshContext` is
// supplied (every `/current/*` route's own `resolveCurrentCart` always supplies one).
//
// Step 5.5 — this `describe` block is also where the trigger-isolation gate (§14/§15:
// "triggers 1-4 and 7 each verified in isolation (no other action re-prices)") lives for
// triggers 2-4 at the command level: each of the four tests below changes EXACTLY ONE of
// digest/currency/locale/staleness and asserts the `priceChanges` reason matches that one
// field, never a different reason. The full isolation picture, assembled across this
// worktree's existing suites rather than duplicated here:
//   - Trigger 1 (tier-crossing quantity change on `.update`): isolated in
//     `commands/__tests__/lines.test.ts` ("re-prices when the new quantity crosses..." fires
//     alone; "does not call the pricing service for a same-tier quantity change..." proves a
//     same-tier `.update` — an action in the SAME command, just not crossing a tier — never
//     re-prices).
//   - Triggers 2/3/4 pure-function isolation (no command/DB involved) already lives in
//     `lib/__tests__/triggers.test.ts`, including the explicit "returns null when nothing
//     differs" control and the "triggers 2/3 never fire for a non-storefront cart" guard.
//   - Trigger 7 (an operator forcing a re-price from the admin cart view, §15 Phase 4):
//     investigated at Step 5.1 and deliberately deferred, not stubbed — no admin cart
//     list/detail route exists anywhere in this worktree yet (confirmed again at this step),
//     so there is no HTTP or command surface to drive it from, isolated or otherwise. See
//     NOTIFY.md's 2026-10-15T08:00:00Z entry for the full investigation. The underlying
//     `cart.reprice` primitive this file tests is already the right one for that future
//     route to call.
//   - "No other action re-prices": `cart.lines.add`/`.remove` never call `cart.reprice` or
//     emit `cart.price.changed` at all (confirmed by reading `commands/lines.ts` — neither
//     command references either), and `lines.test.ts` now asserts this explicitly for both.
describe('cart.get — §5.2 triggers 2-4 (Step 5.1)', () => {
  afterEach(() => {
    jest.clearAllMocks()
    seededCarts = []
    seededCartLines = []
    seededCartPromotionApplications = []
  })

  function seedCartWithLine(cartOverrides: FakeCartRow = {}): FakeCartRow {
    const cart = makeCartFixture({ totalsComputedAt: new Date('2026-01-01T00:00:00.000Z'), ...cartOverrides })
    seededCarts = [cart]
    seededCartLines = [
      {
        id: 'line-1',
        cartId: cart.id,
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
        deletedAt: null,
      },
    ]
    return cart
  }

  it('trigger 2: reprices and discloses a buyer_context_changed priceChange + versionBumpReason when the digest differs', async () => {
    const cart = seedCartWithLine()
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const freshContext = makeRouteContext({ buyerDigest: 'digest-2' })
    const result = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string, freshContext },
      ctx,
    )

    expect(result.found).toBe(true)
    if (!result.found) throw new Error('expected found')
    expect(result.versionBumpReason).toBe('repricing')
    expect(result.priceChanges).toEqual([
      expect.objectContaining({ lineId: 'line-1', reason: 'buyer_context_changed' }),
    ])
    expect(result.cart.buyerDigest).toBe('digest-2')
    expect(result.cart.totals).toEqual({
      subtotalNetAmount: 16,
      subtotalGrossAmount: 19.2,
      discountTotalAmount: 0,
      taxTotalAmount: 3.2,
      grandTotalNetAmount: 16,
      grandTotalGrossAmount: 19.2,
    })
  })

  // Step 5.5 — trigger isolation (§14/§15): the companion to the trigger-2 test above,
  // proving trigger 3's TWO sub-reasons (currency, locale) each fire ALONE — a currency-only
  // drift never reports `locale_changed` and vice versa — at this same `cart.get` command
  // level `detectCartRepriceTrigger` (`lib/__tests__/triggers.test.ts`) already proved in
  // isolation at the pure-function level.
  it('trigger 3 (currency): reprices and discloses a currency_changed priceChange + versionBumpReason when only the currency differs', async () => {
    const cart = seedCartWithLine()
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    // Digest and locale both match the stored cart — ONLY currencyCode differs.
    const freshContext = makeRouteContext({ buyerDigest: 'digest-1', currencyCode: 'EUR', locale: 'en-US' })
    const result = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string, freshContext },
      ctx,
    )

    expect(result.found).toBe(true)
    if (!result.found) throw new Error('expected found')
    expect(result.versionBumpReason).toBe('repricing')
    expect(result.priceChanges).toEqual([
      expect.objectContaining({ lineId: 'line-1', reason: 'currency_changed' }),
    ])
    expect(result.cart.currencyCode).toBe('EUR')
    expect(result.cart.buyerDigest).toBe('digest-1')
    expect(result.cart.locale).toBe('en-US')
  })

  it('trigger 3 (locale): reprices and discloses a locale_changed priceChange + versionBumpReason when only the locale differs', async () => {
    const cart = seedCartWithLine()
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    // Digest and currency both match the stored cart — ONLY locale differs.
    const freshContext = makeRouteContext({ buyerDigest: 'digest-1', currencyCode: 'USD', locale: 'de-DE' })
    const result = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string, freshContext },
      ctx,
    )

    expect(result.found).toBe(true)
    if (!result.found) throw new Error('expected found')
    expect(result.versionBumpReason).toBe('repricing')
    expect(result.priceChanges).toEqual([
      expect.objectContaining({ lineId: 'line-1', reason: 'locale_changed' }),
    ])
    expect(result.cart.locale).toBe('de-DE')
    expect(result.cart.buyerDigest).toBe('digest-1')
    expect(result.cart.currencyCode).toBe('USD')
  })

  it('trigger 4 (staleness): reprices and discloses a stale_snapshot priceChange + versionBumpReason when nothing but the staleness budget differs', async () => {
    // `totalsComputedAt` is 31 minutes in the past — past `DEFAULT_CART_PRICE_STALENESS_MINUTES`
    // (30) — while digest/currency/locale all match the stored cart exactly, isolating trigger
    // 4 from triggers 2/3.
    const cart = seedCartWithLine({ totalsComputedAt: new Date(Date.now() - 31 * 60 * 1000) })
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const freshContext = makeRouteContext({ buyerDigest: 'digest-1', currencyCode: 'USD', locale: 'en-US' })
    const result = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string, freshContext },
      ctx,
    )

    expect(result.found).toBe(true)
    if (!result.found) throw new Error('expected found')
    expect(result.versionBumpReason).toBe('repricing')
    expect(result.priceChanges).toEqual([
      expect.objectContaining({ lineId: 'line-1', reason: 'stale_snapshot' }),
    ])
  })

  it('does not reprice (no write) when nothing differs and the cart is fresh — TC-CART-PRICE-01', async () => {
    const cart = seedCartWithLine({ totalsComputedAt: new Date() })
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const commandBus = makeFakeCommandBus()
    const ctx = makeCtx({ em, dataEngine, commandBus })

    const freshContext = makeRouteContext()
    const result = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string, freshContext },
      ctx,
    )

    expect(result.found).toBe(true)
    if (!result.found) throw new Error('expected found')
    expect(result.versionBumpReason).toBeUndefined()
    expect(result.priceChanges).toBeUndefined()
    expect(commandBus.execute as jest.Mock).not.toHaveBeenCalled()
  })

  // TC-CART-TOT-02 — "totals stored verbatim; no re-rounding on read" at the command layer:
  // odd, non-"clean" decimals (not round numbers a recompute might coincidentally reproduce)
  // make a silent re-sum/re-round detectable. Two consecutive GETs, neither triggering a
  // re-price, must return the exact same totals object both times.
  it('TC-CART-TOT-02: two GETs with no trigger firing both return Cart.totals verbatim, unchanged', async () => {
    const persistedTotals = {
      subtotalNetAmount: 16.3333,
      subtotalGrossAmount: 19.5999,
      discountTotalAmount: 0.0001,
      taxTotalAmount: 3.2666,
      grandTotalNetAmount: 16.3333,
      grandTotalGrossAmount: 19.5999,
    }
    const cart = seedCartWithLine({ totalsComputedAt: new Date(), totals: persistedTotals })
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const commandBus = makeFakeCommandBus()
    const freshContext = makeRouteContext()

    for (let i = 0; i < 2; i += 1) {
      const { em } = makeEm()
      const dataEngine = makeDataEngine()
      const ctx = makeCtx({ em, dataEngine, commandBus })
      const result = await handler!.execute(
        { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string, freshContext },
        ctx,
      )
      expect(result.found).toBe(true)
      if (!result.found) throw new Error('expected found')
      expect(result.cart.totals).toEqual(persistedTotals)
    }
    expect(commandBus.execute as jest.Mock).not.toHaveBeenCalled()
  })

  it('does not reprice a non-active cart even when the digest differs', async () => {
    const cart = seedCartWithLine({ status: 'abandoned' })
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const commandBus = makeFakeCommandBus()
    const ctx = makeCtx({ em, dataEngine, commandBus })

    const freshContext = makeRouteContext({ buyerDigest: 'digest-2' })
    const result = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string, freshContext },
      ctx,
    )

    expect(result.found).toBe(true)
    if (!result.found) throw new Error('expected found')
    expect(result.versionBumpReason).toBeUndefined()
    expect(commandBus.execute as jest.Mock).not.toHaveBeenCalled()
  })

  it('never reprices when no freshContext is supplied (internal by-id caller)', async () => {
    const cart = seedCartWithLine({ totalsComputedAt: new Date('2000-01-01T00:00:00.000Z') })
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const commandBus = makeFakeCommandBus()
    const ctx = makeCtx({ em, dataEngine, commandBus })

    const result = await handler!.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string }, ctx)

    expect(result.found).toBe(true)
    if (!result.found) throw new Error('expected found')
    expect(result.versionBumpReason).toBeUndefined()
    expect(commandBus.execute as jest.Mock).not.toHaveBeenCalled()
  })
})

describe('cart.reprice', () => {
  afterEach(() => {
    jest.clearAllMocks()
    seededCarts = []
    seededCartLines = []
    seededCartPromotionApplications = []
  })

  function seedCartWithLines(cartOverrides: FakeCartRow = {}, lines: FakeCartRow[] = []): FakeCartRow {
    const cart = makeCartFixture({ totalsComputedAt: new Date('2026-01-01T00:00:00.000Z'), ...cartOverrides })
    seededCarts = [cart]
    seededCartLines = lines.length
      ? lines
      : [
          {
            id: 'line-1',
            cartId: cart.id,
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
            deletedAt: null,
          },
        ]
    return cart
  }

  it('re-snapshots every line, recomputes Cart.totals as a real non-zero aggregate, and stamps totalsComputedAt/lastPriceChangeAt', async () => {
    const cart = seedCartWithLines({}, [
      {
        id: 'line-1', cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, productId: 'product-1', variantId: null,
        name: 'Widget', quantity: '2', quantityUnit: null, unitPriceNet: '10', unitPriceGross: '12', taxRate: '20',
        priceKindId: null, priceRowId: 'price-row-1', priceTierMinQuantity: 1, pricedAt: new Date('2026-01-01T00:00:00.000Z'),
        lineTotals: {}, discountTotalNet: null, configuration: null, deletedAt: null,
      },
      {
        id: 'line-2', cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, productId: 'product-2', variantId: null,
        name: 'Gadget', quantity: '1', quantityUnit: null, unitPriceNet: '10', unitPriceGross: '12', taxRate: '20',
        priceKindId: null, priceRowId: 'price-row-1', priceTierMinQuantity: 1, pricedAt: new Date('2026-01-01T00:00:00.000Z'),
        lineTotals: {}, discountTotalNet: null, configuration: null, deletedAt: null,
      },
    ])
    const handler = commandRegistry.get<CartRepriceInput, CartRepriceResult>('cart.reprice')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const result = await handler!.execute(
      { cartId: cart.id as string, tenantId: TENANT_ID, organizationId: ORG_ID, trigger: 'stale_snapshot' },
      ctx,
    )

    // Confirms the whole-cart totals gap flagged since Step 4.7/4.9 is closed: a real,
    // non-zero aggregate across 2 lines, not the old EMPTY_CART_TOTALS placeholder.
    expect(result.cart.totals).toEqual({
      subtotalNetAmount: 16,
      subtotalGrossAmount: 19.2,
      discountTotalAmount: 0,
      taxTotalAmount: 3.2,
      grandTotalNetAmount: 16,
      grandTotalGrossAmount: 19.2,
    })
    expect(result.cart.totals).not.toEqual({
      subtotalNetAmount: 0,
      subtotalGrossAmount: 0,
      discountTotalAmount: 0,
      taxTotalAmount: 0,
      grandTotalNetAmount: 0,
      grandTotalGrossAmount: 0,
    })
    expect(seededCartLines[0].unitPriceNet).toBe('8')
    expect(seededCartLines[1].unitPriceNet).toBe('8')
    expect(result.priceChanges).toHaveLength(2)
    expect(result.cart.lastPriceChangeAt).toBeInstanceOf(Date)
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalled()
    const priceChangedCalls = emitCartEventMock.mock.calls.filter(([eventId]) => eventId === 'cart.price.changed')
    expect(priceChangedCalls).toHaveLength(1)
  })

  it('applies the buyer-context field update onto Cart before re-pricing', async () => {
    const cart = seedCartWithLines()
    const handler = commandRegistry.get<CartRepriceInput, CartRepriceResult>('cart.reprice')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const result = await handler!.execute(
      {
        cartId: cart.id as string,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        trigger: 'buyer_context_changed',
        buyerDigest: 'digest-new',
        customerId: 'customer-1',
        customerIds: ['customer-1'],
        customerUserId: 'customer-user-1',
        customerGroupIds: ['group-1'],
        priceKindId: 'price-kind-1',
      },
      ctx,
    )

    expect(result.cart.buyerDigest).toBe('digest-new')
    expect(result.cart.customerId).toBe('customer-1')
    expect(result.cart.customerGroupIds).toEqual(['group-1'])
    expect(result.cart.priceKindId).toBe('price-kind-1')
  })

  it('throws notFound for a cart in another tenant', async () => {
    seedCartWithLines()
    const handler = commandRegistry.get<CartRepriceInput, CartRepriceResult>('cart.reprice')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    let captured: unknown
    try {
      await handler!.execute({ cartId: 'cart-1', tenantId: 'some-other-tenant', organizationId: ORG_ID, trigger: 'stale_snapshot' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  it('does not disclose a priceChange or stamp lastPriceChangeAt when the resolved price is unchanged', async () => {
    const cart = seedCartWithLines()
    const handler = commandRegistry.get<CartRepriceInput, CartRepriceResult>('cart.reprice')
    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice({ amountNet: 10, amountGross: 12 }))
    const ctx = makeCtx({ em, dataEngine, catalogBuyerPricingService: { resolveLinePrice } })

    const result = await handler!.execute(
      { cartId: cart.id as string, tenantId: TENANT_ID, organizationId: ORG_ID, trigger: 'stale_snapshot' },
      ctx,
    )

    expect(result.priceChanges).toEqual([])
    expect(result.cart.lastPriceChangeAt).toBeNull()
  })

  // Step 7.4 — §6a.2's whole-cart re-visibility pass, gated to trigger 2
  // (`buyer_context_changed`) only. These tests prove: a newly-restricted line gets
  // flagged and excluded from THIS cycle's re-pricing/promotion-evaluation/totals; a
  // previously-flagged line that is visible again gets its flag cleared and re-enters
  // pricing; and the pass never runs for any other trigger, even with a resolved scope.
  describe('cart.reprice — §6a.2 whole-cart re-visibility pass (Step 7.4)', () => {
    it('flags a previously-visible line that has become restricted, excludes it from re-pricing/promotion-evaluation/totals this cycle, and emits visibility_rejected once', async () => {
      const cart = seedCartWithLines({}, [
        {
          id: 'line-1', cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, productId: 'product-1', variantId: null,
          name: 'Widget', quantity: '2', quantityUnit: null, unitPriceNet: '10', unitPriceGross: '12', taxRate: '20',
          priceKindId: null, priceRowId: 'price-row-1', priceTierMinQuantity: 1, pricedAt: new Date('2026-01-01T00:00:00.000Z'),
          lineTotals: {}, discountTotalNet: null, configuration: null, origin: 'customer', flagState: null, deletedAt: null,
        },
      ])
      const handler = commandRegistry.get<CartRepriceInput, CartRepriceResult>('cart.reprice')
      const { em } = makeEm()
      const dataEngine = makeDataEngine()
      const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())
      const evaluate = jest.fn(async () => ({ appliedPromotions: [] }))
      const calculateDocumentTotals = jest.fn(async () => ({
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
      }))
      const catalogScopedProductService = {
        // product-1's category does not match the restrictive scope below.
        loadScopedProducts: jest.fn(async () => new Map([['product-1', { id: 'product-1', categoryIds: ['cat-wholesale'], tagIds: [], isActive: true }]])),
      }
      const ctx = makeCtx({
        em,
        dataEngine,
        catalogBuyerPricingService: { resolveLinePrice },
        promotionsService: { evaluate },
        salesCalculationService: makeSalesCalculationService({ calculateDocumentTotals }),
        catalogScopedProductService,
      })

      const freshContext = makeRouteContext({ buyerDigest: 'digest-2', assortmentScope: [{ categoryIds: ['cat-retail'] }] })
      const result = await handler!.execute(
        {
          cartId: cart.id as string,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          trigger: 'buyer_context_changed',
          buyerDigest: freshContext.buyerDigest,
          customerId: freshContext.customerId,
          customerIds: freshContext.customerIds,
          customerUserId: freshContext.customerUserId,
          customerGroupIds: freshContext.customerGroupIds,
          priceKindId: freshContext.priceKindId,
          routeContext: freshContext,
        },
        ctx,
      )

      expect(seededCartLines[0].flagState).toBe('product_unavailable')
      expect(resolveLinePrice).not.toHaveBeenCalled()
      expect(evaluate.mock.calls[0][0].items).toEqual([])
      expect(calculateDocumentTotals.mock.calls[0][0].lines).toEqual([])
      expect(result.cart.totals).toEqual({
        subtotalNetAmount: 0,
        subtotalGrossAmount: 0,
        discountTotalAmount: 0,
        taxTotalAmount: 0,
        grandTotalNetAmount: 0,
        grandTotalGrossAmount: 0,
      })

      const visibilityRejectedCalls = emitCartEventMock.mock.calls.filter(([eventId]) => eventId === 'cart.line.visibility_rejected')
      expect(visibilityRejectedCalls).toHaveLength(1)
      expect(visibilityRejectedCalls[0][1]).toMatchObject({ cartId: cart.id, rejectedCount: 1, triggeredBy: 'reprice' })
    })

    it('clears the flag on a previously-flagged line that is visible again, and the line re-enters pricing the same cycle', async () => {
      const cart = seedCartWithLines({}, [
        {
          id: 'line-1', cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, productId: 'product-1', variantId: null,
          name: 'Widget', quantity: '2', quantityUnit: null, unitPriceNet: '10', unitPriceGross: '12', taxRate: '20',
          priceKindId: null, priceRowId: 'price-row-1', priceTierMinQuantity: 1, pricedAt: new Date('2026-01-01T00:00:00.000Z'),
          lineTotals: {}, discountTotalNet: null, configuration: null, origin: 'customer', flagState: 'product_unavailable', deletedAt: null,
        },
      ])
      const handler = commandRegistry.get<CartRepriceInput, CartRepriceResult>('cart.reprice')
      const { em } = makeEm()
      const dataEngine = makeDataEngine()
      const resolveLinePrice = jest.fn(async () => makeResolvedLinePrice())
      const catalogScopedProductService = {
        // product-1 now matches the resolved scope.
        loadScopedProducts: jest.fn(async () => new Map([['product-1', { id: 'product-1', categoryIds: ['cat-retail'], tagIds: [], isActive: true }]])),
      }
      const ctx = makeCtx({ em, dataEngine, catalogBuyerPricingService: { resolveLinePrice }, catalogScopedProductService })

      const freshContext = makeRouteContext({ buyerDigest: 'digest-2', assortmentScope: [{ categoryIds: ['cat-retail'] }] })
      await handler!.execute(
        {
          cartId: cart.id as string,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          trigger: 'buyer_context_changed',
          buyerDigest: freshContext.buyerDigest,
          customerId: freshContext.customerId,
          customerIds: freshContext.customerIds,
          customerUserId: freshContext.customerUserId,
          customerGroupIds: freshContext.customerGroupIds,
          priceKindId: freshContext.priceKindId,
          routeContext: freshContext,
        },
        ctx,
      )

      expect(seededCartLines[0].flagState).toBeNull()
      expect(resolveLinePrice).toHaveBeenCalledTimes(1)
      const visibilityRejectedCalls = emitCartEventMock.mock.calls.filter(([eventId]) => eventId === 'cart.line.visibility_rejected')
      expect(visibilityRejectedCalls).toHaveLength(0)
    })

    it('never runs the pass for a trigger other than buyer_context_changed, even with a resolved scope', async () => {
      const cart = seedCartWithLines({}, [
        {
          id: 'line-1', cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, productId: 'product-1', variantId: null,
          name: 'Widget', quantity: '2', quantityUnit: null, unitPriceNet: '10', unitPriceGross: '12', taxRate: '20',
          priceKindId: null, priceRowId: 'price-row-1', priceTierMinQuantity: 1, pricedAt: new Date('2026-01-01T00:00:00.000Z'),
          lineTotals: {}, discountTotalNet: null, configuration: null, origin: 'customer', flagState: null, deletedAt: null,
        },
      ])
      const handler = commandRegistry.get<CartRepriceInput, CartRepriceResult>('cart.reprice')
      const { em } = makeEm()
      const dataEngine = makeDataEngine()
      const loadScopedProducts = jest.fn(async () => new Map())
      const ctx = makeCtx({ em, dataEngine, catalogScopedProductService: { loadScopedProducts } })

      const freshContext = makeRouteContext({ assortmentScope: [{ categoryIds: ['cat-retail'] }] })
      await handler!.execute(
        {
          cartId: cart.id as string,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          trigger: 'stale_snapshot',
          routeContext: freshContext,
        },
        ctx,
      )

      expect(loadScopedProducts).not.toHaveBeenCalled()
      expect(seededCartLines[0].flagState).toBeNull()
    })
  })
})
