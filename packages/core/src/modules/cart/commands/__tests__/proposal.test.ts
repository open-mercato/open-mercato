process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-cart-proposal-accept-tests'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../events', () => ({
  emitCartEvent: jest.fn(async () => undefined),
}))

import { CatalogProduct, CatalogProductPrice, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { Cart, CartLine, CartPromotionApplication } from '../../data/entities'
import { emitCartEvent as mockedEmitCartEvent } from '../../events'

const emitCartEventMock = mockedEmitCartEvent as jest.Mock

type Row = Record<string, any>

let seededCarts: Row[] = []
let seededCartLines: Row[] = []
let seededProducts: Row[] = []
let seededVariants: Row[] = []
let seededPromotionApplications: Row[] = []

function matchesSimpleWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
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
  // Same simplification `commands/__tests__/lines.test.ts` already uses: the batched
  // price-row filter is a complex MikroORM query shape this fake store does not
  // re-implement — the pricing SERVICE itself is mocked below, so this just needs to return
  // something non-empty for `fetchPriceRowsBatch` to pass along.
  if (entity === CatalogProductPrice) return [{ id: 'price-row-1', tenantId: TENANT_ID, organizationId: ORG_ID }]
  if (entity === CartPromotionApplication) return filterRows(seededPromotionApplications, where)
  return []
})

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Row) => {
  if (entity === Cart) return filterRows(seededCarts, where)[0] ?? null
  if (entity === CartLine) return filterRows(seededCartLines, where)[0] ?? null
  if (entity === CatalogProduct) return filterRows(seededProducts, where)[0] ?? null
  if (entity === CatalogProductVariant) return filterRows(seededVariants, where)[0] ?? null
  return null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [unknown, unknown, Row])),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Row])),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { ResolvedCartRouteContext } from '../../lib/routeContext'
import type {
  CartProposalAcceptInput,
  CartProposalAcceptResult,
  CartProposalCreateInput,
  CartProposalCreateResult,
  CartProposalRejectInput,
  CartProposalRejectResult,
} from '../proposal'
import '../proposal'
import { signAcceptanceToken } from '../../lib/acceptanceToken'

const TENANT_ID = 'tenant-prop-1'
const ORG_ID = 'org-prop-1'
const TARGET_CART_ID = 'cart-target'
const AUTHOR_USER_ID = 'rep-user-1'

function makeCartFixture(overrides: Row = {}): Row {
  const now = new Date('2026-03-01T00:00:00.000Z')
  return {
    id: TARGET_CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    tokenHash: 'target-token-hash',
    storeId: null,
    channel: 'api',
    kind: 'basket',
    proposedToCartId: null,
    status: 'active',
    currencyCode: 'USD',
    locale: 'en-US',
    customerId: 'customer-1',
    customerIds: ['customer-1'],
    customerUserId: 'customer-user-1',
    customerGroupIds: ['group-1'],
    priceKindId: null,
    taxMode: 'gross',
    email: null,
    note: null,
    buyerDigest: 'digest-buyer-1',
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
    awaitingApprovalSince: null,
    metadata: null,
    salesChannelId: null,
    lastActivityAt: now,
    lastPriceChangeAt: null,
    lockedAt: null,
    lockExpiresAt: null,
    checkoutSessionId: null,
    mergedIntoCartId: null,
    resolvedAt: null,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
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
    isActive: true,
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

let lineIdCounter = 0
let cartIdCounter = 0

function makeEm() {
  const em: any = {
    fork: jest.fn(),
    create: jest.fn((_ctor: unknown, data: Row) => {
      if (data.kind === 'proposal') return { id: `generated-cart-${++cartIdCounter}`, ...data }
      return { id: `generated-line-${++lineIdCounter}`, deletedAt: null, ...data }
    }),
    persist: jest.fn((row: Row) => {
      if ('kind' in row) seededCarts.push(row)
      else seededCartLines.push(row)
    }),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async (entity: unknown, where: Row, data: Row) => {
      if (entity !== Cart) return 0
      const rows = filterRows(seededCarts, where)
      rows.forEach((row) => Object.assign(row, data))
      return rows.length
    }),
    find: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CartLine) return filterRows(seededCartLines, where)
      if (entity === CartPromotionApplication) return filterRows(seededPromotionApplications, where)
      return []
    }),
    findOne: jest.fn(async () => null),
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

function makeDocumentTotalsFixture(lines: Array<Record<string, any>>) {
  const subtotalNetAmount = lines.reduce((sum, line) => sum + (line.unitPriceNet ?? 0) * line.quantity, 0)
  const subtotalGrossAmount = lines.reduce((sum, line) => sum + (line.unitPriceGross ?? 0) * line.quantity, 0)
  return {
    totals: {
      subtotalNetAmount,
      subtotalGrossAmount,
      discountTotalAmount: 0,
      taxTotalAmount: subtotalGrossAmount - subtotalNetAmount,
      grandTotalNetAmount: subtotalNetAmount,
      grandTotalGrossAmount: subtotalGrossAmount,
    },
  }
}

function makeRbacService(opts: { grant?: boolean } = {}) {
  return { userHasAllFeatures: jest.fn(async () => opts.grant !== false) }
}

function makeCtx(opts: {
  em: unknown
  auth?: CommandRuntimeContext['auth']
  selectedOrganizationId?: string | null
  rbacService?: unknown
  catalogBuyerPricingService?: unknown
  catalogScopedProductService?: unknown
  policyResolutionService?: unknown
  promotionsService?: unknown
  codeService?: unknown
  commandBus?: unknown
}): CommandRuntimeContext {
  const dataEngine = makeDataEngine()
  return {
    container: {
      register: jest.fn(),
      resolve: (token: string): any => {
        if (token === 'em') return opts.em
        if (token === 'dataEngine') return dataEngine
        if (token === 'commandBus') {
          if (opts.commandBus !== undefined) return opts.commandBus
          throw new Error('commandBus not registered in this test')
        }
        if (token === 'rbacService') return opts.rbacService ?? makeRbacService()
        if (token === 'catalogBuyerPricingService') {
          return opts.catalogBuyerPricingService ?? { resolveLinePrice: jest.fn(async () => makeResolvedLinePrice()) }
        }
        if (token === 'salesCalculationService') {
          return {
            calculateLine: jest.fn(async ({ line }: any) => ({
              line,
              netAmount: (line.unitPriceNet ?? 0) * line.quantity,
              grossAmount: (line.unitPriceGross ?? 0) * line.quantity,
              taxAmount: 0,
              discountAmount: 0,
              adjustments: [],
            })),
            calculateDocumentTotals: jest.fn(async ({ lines }: any) => makeDocumentTotalsFixture(lines)),
          }
        }
        if (token === 'promotionsService') {
          return (
            opts.promotionsService ?? {
              evaluate: jest.fn(async () => ({ appliedPromotions: [] })),
              extendReservation: jest.fn(async () => undefined),
              releaseCode: jest.fn(),
            }
          )
        }
        if (token === 'policyResolutionService') {
          if (opts.policyResolutionService) return opts.policyResolutionService
          throw new Error('policyResolutionService not registered (availability disabled)')
        }
        if (token === 'catalogScopedProductService') {
          return (
            opts.catalogScopedProductService ?? {
              loadScopedProducts: jest.fn(async (_em: unknown, ids: string[]) => {
                const result = new Map<string, { id: string; categoryIds: string[]; tagIds: string[]; isActive: boolean }>()
                for (const id of ids) result.set(id, { id, categoryIds: [], tagIds: [], isActive: true })
                return result
              }),
            }
          )
        }
        if (token === 'promotionCodeService') {
          if (opts.codeService !== undefined) return opts.codeService
          throw new Error('promotionCodeService not registered')
        }
        throw new Error(`Unexpected DI token: ${token}`)
      },
    } as any,
    // `opts.auth === undefined` means "not supplied, use the default" — `opts.auth === null`
    // means "explicitly no principal", which `??` would otherwise silently override back to
    // the default (null is nullish too), defeating every "no authenticated principal" test.
    auth: opts.auth === undefined ? { sub: AUTHOR_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID } : opts.auth,
    selectedOrganizationId: opts.selectedOrganizationId ?? ORG_ID,
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

/** Mirrors every sibling `cart` command test's own try/catch convention
 * (`commands/__tests__/lines.test.ts` etc.) rather than `.rejects.toSatisfy(...)` — this
 * project's jest setup has no `jest-extended` matcher registered, and an unmatched promise
 * rejection left unhandled by a missing matcher crashes the Node 24 worker process instead
 * of failing the test cleanly. */
async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (err) {
    return err
  }
  throw new Error('expected the promise to reject, but it resolved')
}

function expectCrudHttpError(err: unknown, status: number, code?: string): void {
  expect(isCrudHttpError(err)).toBe(true)
  expect((err as { status: number }).status).toBe(status)
  if (code) expect((err as { body?: { code?: string } }).body?.code).toBe(code)
}

function resetFixtures() {
  seededCarts = [makeCartFixture()]
  seededCartLines = []
  seededProducts = [makeProductFixture(), makeProductFixture({ id: 'product-2', sku: 'WIDGET-2' })]
  seededVariants = []
  seededPromotionApplications = []
  lineIdCounter = 0
  cartIdCounter = 0
  jest.clearAllMocks()
}

describe('cart.proposal.create', () => {
  beforeEach(resetFixtures)

  it('creates a proposal cart priced as the TARGET buyer, with author fields from the authenticated principal, never the body', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      {
        targetCartId: TARGET_CART_ID,
        lines: [{ productId: 'product-1', quantity: '2' }],
      },
      ctx,
    )

    expect(result.rejectedLines).toEqual([])
    expect(result.lines).toHaveLength(1)

    const proposalCart = seededCarts.find((row) => row.id === result.proposalCartId)!
    expect(proposalCart.kind).toBe('proposal')
    expect(proposalCart.proposedToCartId).toBe(TARGET_CART_ID)
    // Priced as the TARGET, never the author: customer/group/price-kind identity copied
    // from the target cart, not from `ctx.auth`.
    expect(proposalCart.customerId).toBe('customer-1')
    expect(proposalCart.customerGroupIds).toEqual(['group-1'])
    expect(proposalCart.currencyCode).toBe('USD')

    const line = seededCartLines.find((row) => row.cartId === result.proposalCartId)!
    // R16: the authenticated principal, never anything the body could carry (this input
    // type has no `addedByActorId` field at all).
    expect(line.addedByActorType).toBe('rep')
    expect(line.addedByActorId).toBe(AUTHOR_USER_ID)

    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.proposal.created',
      expect.objectContaining({
        proposalCartId: result.proposalCartId,
        targetCartId: TARGET_CART_ID,
        authoredByActorType: 'rep',
        authoredByActorId: AUTHOR_USER_ID,
        lineCount: 1,
      }),
    )
  })

  it('reports a visibility-rejected line in `rejectedLines` and `warnings`, never silently drops it, and emits `cart.line.visibility_rejected` with `triggeredBy: proposal_create`', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    const em = makeEm()
    const scopedService = {
      loadScopedProducts: jest.fn(async () => {
        const result = new Map<string, { id: string; categoryIds: string[]; tagIds: string[]; isActive: boolean }>()
        // product-1 passes the scope (shares the 'allowed' category); product-2 fails it.
        result.set('product-1', { id: 'product-1', categoryIds: ['allowed'], tagIds: [], isActive: true })
        result.set('product-2', { id: 'product-2', categoryIds: ['blocked'], tagIds: [], isActive: true })
        return result
      }),
    }
    const ctx = makeCtx({ em, catalogScopedProductService: scopedService })
    const routeContext = makeRouteContext({ assortmentScope: [{ categoryIds: ['allowed'], tagIds: [] }] })

    const result = await handler.execute(
      {
        targetCartId: TARGET_CART_ID,
        lines: [
          { productId: 'product-1', quantity: '1' },
          { productId: 'product-2', quantity: '1' },
        ],
        routeContext,
      },
      ctx,
    )

    expect(result.rejectedLines).toEqual([{ productId: 'product-2', variantId: null, reason: 'product_unavailable' }])
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'product_unavailable' }),
    ])
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBe('product-1')

    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.line.visibility_rejected',
      expect.objectContaining({ cartId: TARGET_CART_ID, rejectedCount: 1, triggeredBy: 'proposal_create' }),
    )
  })

  it('refuses with 422 proposal_empty when every line is visibility-rejected, and creates nothing', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    const em = makeEm()
    const scopedService = {
      loadScopedProducts: jest.fn(async () => new Map()),
    }
    const ctx = makeCtx({ em, catalogScopedProductService: scopedService })
    const routeContext = makeRouteContext({ assortmentScope: [{ categoryIds: ['allowed'], tagIds: [] }] })

    const err = await captureError(() =>
      handler.execute({ targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }], routeContext }, ctx),
    )
    expectCrudHttpError(err, 422, 'proposal_empty')

    expect(seededCarts).toHaveLength(1)
    expect(seededCartLines).toHaveLength(0)
  })

  it('never accepts a promotion code (S14/K14): the input type carries no code field, and no reservation is ever requested', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    const em = makeEm()
    const reserveCode = jest.fn()
    const ctx = makeCtx({ em, promotionsService: { evaluate: jest.fn(async () => ({ appliedPromotions: [] })), extendReservation: jest.fn(), releaseCode: jest.fn(), reserveCode } })

    await handler.execute(
      // `codeString`/`codes` is not a field of `CartProposalCreateInput` — cast through
      // `any` to prove even a caller that tries to smuggle one in gets ignored.
      { targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }], codeString: 'SAVE10' } as any,
      ctx,
    )

    expect(reserveCode).not.toHaveBeenCalled()
    expect(seededPromotionApplications).toHaveLength(0)
  })

  it('refuses a storefront target with no routeContext (400 assortment_scope_required_for_storefront_channel)', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    seededCarts = [makeCartFixture({ channel: 'storefront', storeId: 'store-1' })]
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await captureError(() =>
      handler.execute({ targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }] }, ctx),
    )
    expectCrudHttpError(err, 400, 'assortment_scope_required_for_storefront_channel')
  })

  it('refuses without an authenticated principal (403)', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    const em = makeEm()
    const ctx = makeCtx({ em, auth: null })

    const err = await captureError(() =>
      handler.execute({ targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }] }, ctx),
    )
    expectCrudHttpError(err, 403)
  })

  it('refuses a principal lacking cart.proposals.author (403)', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    const em = makeEm()
    const ctx = makeCtx({ em, rbacService: makeRbacService({ grant: false }) })

    const err = await captureError(() =>
      handler.execute({ targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }] }, ctx),
    )
    expectCrudHttpError(err, 403)
  })

  it('refuses a locked target with 423 cart_locked', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    seededCarts = [makeCartFixture({ status: 'locked', checkoutSessionId: 'session-1' })]
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await captureError(() =>
      handler.execute({ targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }] }, ctx),
    )
    expectCrudHttpError(err, 423)
  })

  it('refuses a converted target with 409 cart_not_active', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    seededCarts = [makeCartFixture({ status: 'converted' })]
    const em = makeEm()
    const ctx = makeCtx({ em })

    const err = await captureError(() =>
      handler.execute({ targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }] }, ctx),
    )
    expectCrudHttpError(err, 409)
  })

  it('does not reactivate an abandoned target — authoring is not buyer activity', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    seededCarts = [makeCartFixture({ status: 'abandoned' })]
    const em = makeEm()
    const ctx = makeCtx({ em })

    await handler.execute({ targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }] }, ctx)

    const target = seededCarts.find((row) => row.id === TARGET_CART_ID)!
    expect(target.status).toBe('abandoned')
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('defaults ttlSeconds to 259200 and bounds an out-of-range value', async () => {
    const handler = getHandler<CartProposalCreateInput, CartProposalCreateResult>('cart.proposal.create')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute({ targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }] }, ctx)
    const proposalCart = seededCarts.find((row) => row.id === result.proposalCartId)!
    const expiresAt = new Date(proposalCart.expiresAt as Date)
    const createdAt = new Date(proposalCart.createdAt ?? proposalCart.totalsComputedAt)
    expect(expiresAt.getTime() - createdAt.getTime()).toBeGreaterThan(259_000 * 1000)

    await captureError(() =>
      handler.execute({ targetCartId: TARGET_CART_ID, lines: [{ productId: 'product-1', quantity: '1' }], ttlSeconds: 1 }, makeCtx({ em: makeEm() })),
    )
  })
})

describe('every basket-only command still refuses a kind = proposal cart (regression guard)', () => {
  beforeEach(resetFixtures)

  it('cart.get answers {found:false} for a proposal id', async () => {
    jest.isolateModules(() => {
      // isolateModules not strictly needed here, kept simple below instead.
    })
    const { getCartCommand } = require('../cart')
    seededCarts = [makeCartFixture({ id: 'cart-proposal-1', kind: 'proposal', proposedToCartId: TARGET_CART_ID })]
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await getCartCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: 'cart-proposal-1' }, ctx)
    expect(result.found).toBe(false)
  })
})

describe('cart.proposal.reject', () => {
  beforeEach(() => {
    resetFixtures()
    seededCarts.push(
      makeCartFixture({
        id: 'proposal-1',
        kind: 'proposal',
        proposedToCartId: TARGET_CART_ID,
        status: 'active',
        resolvedAt: null,
      }),
    )
    seededCartLines.push({
      id: 'proposal-line-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: 'proposal-1',
      productId: 'product-1',
      variantId: null,
      addedByActorType: 'rep',
      addedByActorId: AUTHOR_USER_ID,
      deletedAt: null,
    })
  })

  it('buyer-side rejection: transitions the proposal to abandoned, sets resolvedAt, and emits cart.proposal.rejected with rejectedBy=buyer, with no ACL feature required', async () => {
    const handler = getHandler<CartProposalRejectInput, CartProposalRejectResult>('cart.proposal.reject')
    const em = makeEm()
    const ctx = makeCtx({ em, auth: null })

    const result = await handler.execute(
      { proposalCartId: 'proposal-1', tenantId: TENANT_ID, organizationId: ORG_ID, rejectedBy: 'buyer' },
      ctx,
    )

    expect(result).toEqual({ proposalCartId: 'proposal-1', status: 'abandoned', alreadyResolved: false })
    const proposal = seededCarts.find((row) => row.id === 'proposal-1')!
    expect(proposal.status).toBe('abandoned')
    expect(proposal.resolvedAt).not.toBeNull()
    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.proposal.rejected',
      expect.objectContaining({ proposalCartId: 'proposal-1', rejectedBy: 'buyer', targetCartId: TARGET_CART_ID }),
    )
  })

  it('author-side withdraw: requires cart.proposals.author and transitions the proposal the same way', async () => {
    const handler = getHandler<CartProposalRejectInput, CartProposalRejectResult>('cart.proposal.reject')
    const em = makeEm()
    const ctx = makeCtx({ em })

    const result = await handler.execute(
      { proposalCartId: 'proposal-1', tenantId: TENANT_ID, organizationId: ORG_ID, rejectedBy: 'author' },
      ctx,
    )

    expect(result.status).toBe('abandoned')
    expect(emitCartEventMock).toHaveBeenCalledWith('cart.proposal.rejected', expect.objectContaining({ rejectedBy: 'author' }))
  })

  it('author-side withdraw refuses a principal lacking cart.proposals.author (403)', async () => {
    const handler = getHandler<CartProposalRejectInput, CartProposalRejectResult>('cart.proposal.reject')
    const em = makeEm()
    const ctx = makeCtx({ em, rbacService: makeRbacService({ grant: false }) })

    const err = await captureError(() =>
      handler.execute({ proposalCartId: 'proposal-1', tenantId: TENANT_ID, organizationId: ORG_ID, rejectedBy: 'author' }, ctx),
    )
    expectCrudHttpError(err, 403)
  })

  it('a system-actor call (no ctx.auth) rejecting as author is trusted without an ACL check', async () => {
    const handler = getHandler<CartProposalRejectInput, CartProposalRejectResult>('cart.proposal.reject')
    const em = makeEm()
    const ctx = makeCtx({ em, auth: null })

    const result = await handler.execute(
      { proposalCartId: 'proposal-1', tenantId: TENANT_ID, organizationId: ORG_ID, rejectedBy: 'author' },
      ctx,
    )
    expect(result.status).toBe('abandoned')
  })

  it('rejecting a proposal that is not active is a no-op returning its current status', async () => {
    seededCarts = seededCarts.map((row) => (row.id === 'proposal-1' ? { ...row, status: 'merged' } : row))
    const handler = getHandler<CartProposalRejectInput, CartProposalRejectResult>('cart.proposal.reject')
    const em = makeEm()
    const ctx = makeCtx({ em, auth: null })

    const result = await handler.execute(
      { proposalCartId: 'proposal-1', tenantId: TENANT_ID, organizationId: ORG_ID, rejectedBy: 'buyer' },
      ctx,
    )
    expect(result).toEqual({ proposalCartId: 'proposal-1', status: 'merged', alreadyResolved: true })
    expect(emitCartEventMock).not.toHaveBeenCalledWith('cart.proposal.rejected', expect.anything())
  })

  it('releases code reservations by cartId for every CartPromotionApplication row (S14/K14) — best-effort, never blocks the transition', async () => {
    seededPromotionApplications = [
      { id: 'app-1', cartId: 'proposal-1', tenantId: TENANT_ID, organizationId: ORG_ID, codeId: 'code-1' },
    ]
    const handler = getHandler<CartProposalRejectInput, CartProposalRejectResult>('cart.proposal.reject')
    const em = makeEm()
    const releaseCode = jest.fn(async () => undefined)
    const ctx = makeCtx({ em, auth: null, codeService: { releaseCode } })

    const result = await handler.execute(
      { proposalCartId: 'proposal-1', tenantId: TENANT_ID, organizationId: ORG_ID, rejectedBy: 'buyer' },
      ctx,
    )

    expect(result.status).toBe('abandoned')
    expect(releaseCode).toHaveBeenCalledWith(em, 'code-1', 'proposal-1', { tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('supersede-on-merge: after one of two sibling proposals targeting the same cart is accepted (simulated by status=merged), exactly one remains live, and the sibling is never touched', async () => {
    seededCarts.push(
      makeCartFixture({ id: 'proposal-2', kind: 'proposal', proposedToCartId: TARGET_CART_ID, status: 'active', resolvedAt: null }),
    )
    // Simulate Step 3.4's own acceptance flow (`cart.merge { strategy: 'manual' }`, out of
    // this Step's scope) by moving proposal-1 straight to its post-acceptance terminal
    // status — per the assisted-selling spec (§6.1: "Both proposals are live... neither
    // blocks the other"), nothing in `cart.proposal.reject`/`.create` ever touches a sibling.
    seededCarts = seededCarts.map((row) => (row.id === 'proposal-1' ? { ...row, status: 'merged' } : row))

    const liveProposals = seededCarts.filter(
      (row) => row.kind === 'proposal' && row.proposedToCartId === TARGET_CART_ID && row.status === 'active',
    )
    expect(liveProposals).toHaveLength(1)
    expect(liveProposals[0].id).toBe('proposal-2')
  })
})

describe('cart.proposal.accept', () => {
  const PROPOSAL_ID = 'proposal-1'

  function makeFreshToken(targetUpdatedAt: Date, proposalUpdatedAt: Date) {
    return signAcceptanceToken({
      proposalCartId: PROPOSAL_ID,
      targetCartId: TARGET_CART_ID,
      proposalUpdatedAt: proposalUpdatedAt.toISOString(),
      targetUpdatedAt: targetUpdatedAt.toISOString(),
    })
  }

  function makeMergeResultFixture(overrides: Row = {}): Row {
    return {
      cart: { id: TARGET_CART_ID, updatedAt: new Date('2026-03-01T02:00:00.000Z') },
      token: 'rotated-plaintext-token',
      mergeSummary: { strategy: 'manual', mergeLogId: 'merge-log-1', adopted: false, counts: { merged: 0, summed: 0, capped: 0, declined: 1, rejected: 0 }, lines: [] },
      priceChanges: [],
      ...overrides,
    }
  }

  function makeCommandBus(execute: jest.Mock) {
    return { execute }
  }

  beforeEach(() => {
    resetFixtures()
    seededCarts.push(
      makeCartFixture({
        id: PROPOSAL_ID,
        kind: 'proposal',
        proposedToCartId: TARGET_CART_ID,
        status: 'active',
        resolvedAt: null,
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    )
  })

  it('delegates to cart.merge with the manual input when the acceptanceToken is fresh, and emits cart.proposal.accepted', async () => {
    const handler = getHandler<CartProposalAcceptInput, CartProposalAcceptResult>('cart.proposal.accept')
    const em = makeEm()
    const target = seededCarts.find((row) => row.id === TARGET_CART_ID)!
    const proposal = seededCarts.find((row) => row.id === PROPOSAL_ID)!
    const token = makeFreshToken(target.updatedAt, proposal.updatedAt)
    const mergeResult = makeMergeResultFixture()
    const execute = jest.fn(async (id: string, options: { input: unknown }) => {
      expect(id).toBe('cart.merge')
      expect(options.input).toMatchObject({
        targetCartId: TARGET_CART_ID,
        proposalCartId: PROPOSAL_ID,
        lines: [{ proposalLineId: 'line-1', accepted: true }],
      })
      return { result: mergeResult }
    })
    const ctx = makeCtx({ em, auth: null, commandBus: makeCommandBus(execute) })

    const result = await handler.execute(
      {
        proposalCartId: PROPOSAL_ID,
        targetCartId: TARGET_CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        acceptanceToken: token,
        lines: [{ proposalLineId: 'line-1', accepted: true }],
        routeContext: makeRouteContext(),
      },
      ctx,
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.cart.id).toBe(TARGET_CART_ID)
    expect(result.token).toBe('rotated-plaintext-token')
    expect(result.acceptedLineCount).toBe(1)
    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.proposal.accepted',
      expect.objectContaining({
        proposalCartId: PROPOSAL_ID,
        targetCartId: TARGET_CART_ID,
        mergeLogId: 'merge-log-1',
        acceptedLineCount: 1,
      }),
    )
  })

  it('404s when the target cart does not exist', async () => {
    const handler = getHandler<CartProposalAcceptInput, CartProposalAcceptResult>('cart.proposal.accept')
    const em = makeEm()
    const ctx = makeCtx({ em, auth: null })

    const err = await captureError(() =>
      handler.execute(
        {
          proposalCartId: PROPOSAL_ID,
          targetCartId: 'cart-does-not-exist',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          acceptanceToken: 'whatever',
          lines: [],
          routeContext: makeRouteContext(),
        },
        ctx,
      ),
    )
    expectCrudHttpError(err, 404)
  })

  it('404s when the proposal id is not addressed to this target (K10 — same body as a nonexistent id)', async () => {
    seededCarts.push(
      makeCartFixture({ id: 'other-target', customerUserId: 'other-customer-user' }),
      makeCartFixture({ id: 'proposal-elsewhere', kind: 'proposal', proposedToCartId: 'other-target', status: 'active' }),
    )
    const handler = getHandler<CartProposalAcceptInput, CartProposalAcceptResult>('cart.proposal.accept')
    const em = makeEm()
    const ctx = makeCtx({ em, auth: null })

    const err = await captureError(() =>
      handler.execute(
        {
          proposalCartId: 'proposal-elsewhere',
          targetCartId: TARGET_CART_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          acceptanceToken: 'whatever',
          lines: [],
          routeContext: makeRouteContext(),
        },
        ctx,
      ),
    )
    expectCrudHttpError(err, 404)
  })

  it('409 proposal_changed with a fresh preview + token when the acceptanceToken is stale (the target moved since preview), and never calls cart.merge', async () => {
    const handler = getHandler<CartProposalAcceptInput, CartProposalAcceptResult>('cart.proposal.accept')
    const em = makeEm()
    const target = seededCarts.find((row) => row.id === TARGET_CART_ID)!
    const proposal = seededCarts.find((row) => row.id === PROPOSAL_ID)!
    // Minted against the target's PREVIOUS updatedAt — a fresh token would use the current one.
    const staleToken = makeFreshToken(new Date(target.updatedAt.getTime() - 60_000), proposal.updatedAt)
    const execute = jest.fn()
    const ctx = makeCtx({ em, auth: null, commandBus: makeCommandBus(execute) })

    const err = await captureError(() =>
      handler.execute(
        {
          proposalCartId: PROPOSAL_ID,
          targetCartId: TARGET_CART_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          acceptanceToken: staleToken,
          lines: [{ proposalLineId: 'line-1', accepted: true }],
          routeContext: makeRouteContext(),
        },
        ctx,
      ),
    )

    expectCrudHttpError(err, 409, 'proposal_changed')
    const body = (err as { body?: Record<string, unknown> }).body
    expect(body?.acceptancePreview).toBeDefined()
    expect(typeof body?.acceptanceToken).toBe('string')
    expect(execute).not.toHaveBeenCalled()
  })

  it('409 proposal_changed for a malformed/garbage acceptanceToken, never calling cart.merge', async () => {
    const handler = getHandler<CartProposalAcceptInput, CartProposalAcceptResult>('cart.proposal.accept')
    const em = makeEm()
    const execute = jest.fn()
    const ctx = makeCtx({ em, auth: null, commandBus: makeCommandBus(execute) })

    const err = await captureError(() =>
      handler.execute(
        {
          proposalCartId: PROPOSAL_ID,
          targetCartId: TARGET_CART_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          acceptanceToken: 'not-a-real-token',
          lines: [{ proposalLineId: 'line-1', accepted: true }],
          routeContext: makeRouteContext(),
        },
        ctx,
      ),
    )

    expectCrudHttpError(err, 409, 'proposal_changed')
    expect(execute).not.toHaveBeenCalled()
  })
})
