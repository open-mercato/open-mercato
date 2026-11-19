/**
 * #8268 review Major 1 (re-review, M1), and the follow-up re-review finding (pkarw,
 * 2026-11-19): `reauthorOnMerge.test.ts` proves the handler passes the REAL `ctx.container`
 * straight through (identity) when the event bus supplies one, and
 * `promotions/__tests__/promotionsDiContainerScope.test.ts` proves `promotionsService` is
 * only visible to a `.register({ auth: ... })` call made on that SAME real container — never
 * a local resolver-overlay shim. Neither proves the two facts TOGETHER: this suite runs the
 * REAL `reauthorProposalForMergeRetarget` (never mocked here, unlike every test in
 * `reauthorOnMerge.test.ts`) through a real `cart.proposal.create` dispatch, against the
 * real `promotions/di.ts` registration, with an actual cart line and an actual promotion.
 *
 * Follow-up fix: `cart.proposal.create` is now the REAL command handler
 * (`cart/commands/proposal.ts`, side-effect imported below so it self-registers), never a
 * local stand-in that reimplements its own `.register({ auth: ... })` call. A regression in
 * the production handler's own auth-wiring sequence (`buildCartPromotionsAndTotalsPhases`,
 * `cart/commands/lines.ts`) now fails THIS suite directly instead of only a hand-copied
 * mirror of it. `cart.proposal.reject` is real for the same reason — importing the real
 * `proposal.ts` module registers all three of its commands under their real ids, and a
 * second, conflicting registration for the same id is not an option. What stays a stand-in:
 * nothing cross-module-leaf-shaped is left standing in for this test's own two commands; the
 * only remaining simplification is `CatalogProductPrice`'s own row shape (the pricing SERVICE
 * itself is mocked, so the batched price-row filter result's shape does not matter — same
 * precedent `commands/__tests__/proposal.test.ts` already set for exercising this exact real
 * handler against a lightweight fake store).
 *
 * A brand-new proposal cart has no existing `CartPromotionApplication` rows to derive a held
 * code from (`cart/commands/proposal.ts`'s own header comment: "only automatic (non-code)
 * promotions can ever apply here"), so the fixture promotion below is automatic (empty
 * `rules`), not code-gated — the stand-in's old `codes` input is gone along with it.
 *
 * If the subscriber ever regresses to wrapping `ctx.container` in the local resolver-overlay
 * shim instead of passing it straight through, `promotionsService.evaluate()`'s own
 * `resolvePromotionsServiceScope` fails closed (400, scope required): the real
 * `cart.proposal.create` handler throws, `performAuthorProposal` throws,
 * `retargetOrSupersedeOneProposal`'s own documented fallback catches it and supersedes the
 * proposal instead of re-authoring it — so this suite's "re-authors, applying the real
 * promotion" assertions fail.
 */
import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { register as registerPromotionsDi } from '@open-mercato/core/modules/promotions/di'
import type { NormalizedPromotion, PromotionsService } from '@open-mercato/core/modules/promotions/lib/types'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Cart, CartLine, CartPromotionApplication } from '@open-mercato/core/modules/cart/data/entities'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import {
  AssistedSellingProposal,
  AssistedSellingStoreSettings,
  AssistedSellingThread,
} from '../../data/entities'
import { CART_PROPOSAL_CREATE_COMMAND_ID } from '../cartProposalCommands'
import { handleCartMergedForAssistedSellingReauthor } from '../reauthorOnMerge'

jest.mock('@open-mercato/core/modules/cart/events', () => ({
  emitCartEvent: jest.fn(async () => undefined),
}))

// Real `cart.proposal.create`/`.reject`/`.accept` self-register under their real command ids
// on import (never a static cross-module import from production code — see
// `assisted_selling/lib/cartProposalCommands.ts`'s own header comment — but accepted here,
// test-only, for the exact reason `promotions/di.ts`'s real registration already is below).
import '@open-mercato/core/modules/cart/commands/proposal'

type Row = Record<string, any>

const TENANT_ID = 'tenant-real-promo-1'
const ORG_ID = 'org-real-promo-1'
const STORE_ID = 'store-real-promo-1'
const OLD_TARGET_ID = 'cart-old-target-real-promo'
const NEW_TARGET_ID = 'cart-new-target-real-promo'
const AUTHOR_USER_ID = 'rep-user-real-promo-1'
const THREAD_ID = 'thread-real-promo-1'
const PROPOSAL_CART_ID = 'proposal-cart-real-promo-1'
const PRODUCT_ID = 'product-real-promo-1'

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (value && typeof value === 'object' && !(value instanceof Date) && '$in' in value) {
      return (value as { $in: unknown[] }).$in.includes(row[key])
    }
    return (row[key] ?? null) === (value ?? null)
  })
}

function filterRows(rows: Row[], where: Row): Row[] {
  return rows.filter((row) => matches(row, where))
}

// `promotions-service.ts#resolveCategoryIdsForProducts` reads category/tag assignments via
// `em.getKysely()` whenever `catalogScopedProductService` resolves (it does here, for the
// visibility check `cart.proposal.create` itself needs) — this suite's own product carries
// no category/tag assignments, so every table read comes back empty.
function fakeKysely() {
  const node: Row = {
    selectFrom: () => node,
    innerJoin: () => node,
    select: () => node,
    where: () => node,
    execute: async () => [],
  }
  return () => node
}

function makeProposal(): Row {
  return {
    id: 'proposal-real-promo-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    threadId: THREAD_ID,
    proposalCartId: PROPOSAL_CART_ID,
    targetCartId: OLD_TARGET_ID,
    authoredByActorType: 'rep',
    authoredByActorId: AUTHOR_USER_ID,
    status: 'published',
    resolvedAt: null,
    supersededByProposalId: null,
    deletedAt: null,
  }
}

function makeThread(): Row {
  return {
    id: THREAD_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: STORE_ID,
    buyerCartId: OLD_TARGET_ID,
    status: 'open',
    customerId: null,
    customerUserId: null,
    closedAt: null,
    liveProposalCount: 1,
    deletedAt: null,
  }
}

function makeMergedPayload(): Row {
  return {
    sourceCartId: OLD_TARGET_ID,
    targetCartId: NEW_TARGET_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'basket',
    customerId: null,
    customerUserId: null,
  }
}

// §6.3's "actual cart line" — the proposal cart line `cartService.getProposalCartLines`
// would hand back, each with a real priced product behind it.
const CART_LINE = { productId: PRODUCT_ID, variantId: null, quantity: '2', configuration: null }

function makeTargetCartFixture(): Row {
  const now = new Date('2026-03-01T00:00:00.000Z')
  return {
    id: NEW_TARGET_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    tokenHash: 'target-token-hash-real-promo',
    storeId: STORE_ID,
    channel: 'api',
    kind: 'basket',
    proposedToCartId: null,
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
    buyerDigest: 'digest-buyer-real-promo-1',
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
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  }
}

// The OLD proposal's own proposal cart — never looked up by `cart.proposal.create` (which
// only reads the NEW target), but `cart.proposal.reject` (dispatched by
// `reauthorProposalForMergeRetarget` once the successor is linked) looks it up by this id.
function makeOldProposalCartFixture(): Row {
  return {
    id: PROPOSAL_CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    tokenHash: 'old-proposal-token-hash',
    storeId: STORE_ID,
    channel: 'api',
    kind: 'proposal',
    proposedToCartId: OLD_TARGET_ID,
    status: 'active',
    currencyCode: 'USD',
    locale: 'en-US',
    resolvedAt: null,
  }
}

function makeProductFixture(): Row {
  return {
    id: PRODUCT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    title: 'Real Promo Product',
    sku: 'SKU-REAL-PROMO-1',
    minOrderQty: null,
    maxOrderQty: null,
    orderQtyIncrement: null,
    deletedAt: null,
    isActive: true,
  }
}

let seededCarts: Row[] = []
let seededCartLines: Row[] = []
let seededProducts: Row[] = []
let seededCartPromotionApplications: Row[] = []
let lineIdCounter = 0
let applicationIdCounter = 0

function makeFakeEm() {
  const proposals = [makeProposal()]
  const threads = [makeThread()]
  const participants: Row[] = []
  const users: Row[] = [{ id: AUTHOR_USER_ID, tenantId: TENANT_ID, deletedAt: null, name: 'Real Promo Rep' }]
  const storeSettings: Row[] = [
    {
      id: 'settings-real-promo-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      mode: 'rep',
      proposalTtlSeconds: 259200,
      maxProposalLines: 50,
      conversationRetentionDays: 365,
      idleCloseDays: 30,
      deletedAt: null,
    },
  ]
  const em: Row = {
    getKysely: fakeKysely(),
    find: async (Cls: unknown, where: Row) => {
      if (Cls === AssistedSellingProposal) return filterRows(proposals, where)
      if (Cls === Cart) return filterRows(seededCarts, where)
      if (Cls === CartLine) return filterRows(seededCartLines, where)
      if (Cls === CatalogProduct) return filterRows(seededProducts, where)
      if (Cls === CartPromotionApplication) return filterRows(seededCartPromotionApplications, where)
      return []
    },
    findOne: async (Cls: unknown, where: Row) => {
      const rows =
        Cls === AssistedSellingThread
          ? threads
          : Cls === AssistedSellingProposal
            ? proposals
            : Cls === User
              ? users
              : Cls === AssistedSellingStoreSettings
                ? storeSettings
                : Cls === Cart
                  ? seededCarts
                  : Cls === CartLine
                    ? seededCartLines
                    : Cls === CatalogProduct
                      ? seededProducts
                      : []
      return rows.find((row) => matches(row, where)) ?? null
    },
    create: (Cls: unknown, data: Row) => {
      if (Cls === require('../../data/entities').AssistedSellingParticipant) {
        const row = { ...data }
        participants.push(row)
        return row
      }
      if (Cls === Cart) return { ...data }
      if (Cls === CartPromotionApplication) return { id: `generated-application-${++applicationIdCounter}`, ...data }
      // CartLine — never carries its own `id` from `cart/commands/proposal.ts`'s own
      // `em.create` call, same as `commands/__tests__/proposal.test.ts`'s own fake store.
      return { id: `generated-line-${++lineIdCounter}`, deletedAt: null, ...data }
    },
    persist: (row: Row) => {
      if ('effect' in row) seededCartPromotionApplications.push(row)
      else if ('kind' in row) seededCarts.push(row)
      else seededCartLines.push(row)
    },
    remove: () => undefined,
    flush: async () => undefined,
    begin: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    isInTransaction: () => false,
    refresh: async () => undefined,
    nativeUpdate: async (Cls: unknown, where: Row, data: Row) => {
      const rows = Cls === AssistedSellingProposal ? proposals : Cls === Cart ? seededCarts : []
      const matching = rows.filter((row) => matches(row, where))
      matching.forEach((row) => Object.assign(row, data))
      return matching.length
    },
    execute: async () => [],
  }
  em.fork = () => em
  return { em, proposals, threads }
}

function makeCartService() {
  return {
    getProposalCartLines: async () => [CART_LINE],
    getForOrganizations: async () => null,
  }
}

function makeRbac() {
  return { userHasAllFeatures: async () => true }
}

function makeStoreContextService() {
  return { resolveForBuyer: async () => ({ assortmentScope: null }) }
}

function makeDataEngine() {
  return { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn(async () => {}) }
}

function makeResolvedLinePrice(): Row {
  return {
    priceRow: { id: 'price-row-real-promo-1' },
    amountNet: 50,
    amountGross: 60,
    taxRatePercent: 20,
    priceIsPromotional: false,
    currentTier: { minQuantity: 1, maxQuantity: null, amountNet: 50, amountGross: 60 },
    nextTier: null,
    tiers: [],
  }
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

function makeCatalogScopedProductService() {
  return {
    loadScopedProducts: async (_em: unknown, ids: string[]) => {
      const result = new Map<string, { id: string; categoryIds: string[]; tagIds: string[]; isActive: boolean }>()
      for (const id of ids) result.set(id, { id, categoryIds: [], tagIds: [], isActive: true })
      return result
    },
  }
}

/** The simplest real rule/benefit pairing — no rules at all (always matches, S14/K14's
 * "automatic (non-code) promotions") plus an order-level `cart_discount` benefit, mirroring
 * `evaluation-engine.test.ts`'s own `promotion()` default. A brand-new proposal cart has no
 * `CartPromotionApplication` row to derive a held CODE from, so a code-gated rule (the old
 * stand-in's own fixture) could never match here — real cart-line items (unlike that file's
 * empty-items fixtures) make the 10% discount compute against this suite's own actual line,
 * not a zero subtotal. */
function buildRealMatchingPromotion(): NormalizedPromotion {
  return {
    id: 'promo-real-1',
    name: 'Real Promo DI Scope Test',
    order: 0,
    cumulative: true,
    tags: [],
    excludedTags: [],
    excludeFlags: {},
    eligibleCurrencies: [],
    startsAt: null,
    endsAt: null,
    maxBudget: null,
    budgetCurrency: null,
    totalDiscountGranted: '0',
    rootGroup: {
      operator: 'and',
      rules: [],
      benefits: [
        {
          type: 'cart_discount',
          appliesTo: 'order',
          config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'Real promo' } },
        },
      ],
      children: [],
    },
  }
}

/** Builds the REAL Awilix container the subscriber receives as `ctx.container` — real
 * `promotions/di.ts` registration (only `promotionCacheService` swapped for a fixture,
 * exactly like `promotionsDiContainerScope.test.ts#buildRealContainer`), a real `CommandBus`
 * dispatching to the REAL `cart.proposal.create`/`.reject` (imported above for their
 * self-registration side effect), and every peer those real handlers and this subscriber's
 * own chain resolve by name — `em`, `rbacService`, `cartService`, `storeContextService`,
 * `dataEngine`, `catalogBuyerPricingService`, `salesCalculationService`,
 * `catalogScopedProductService`. */
function buildRealContainerAndCommandBus(em: Row) {
  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  const commandBus = new CommandBus()
  container.register({
    em: asValue(em),
    commandBus: asValue(commandBus),
    rbacService: asValue(makeRbac()),
    cartService: asValue(makeCartService()),
    storeContextService: asValue(makeStoreContextService()),
    dataEngine: asValue(makeDataEngine()),
    catalogBuyerPricingService: asValue({ resolveLinePrice: jest.fn(async () => makeResolvedLinePrice()) }),
    salesCalculationService: asValue({
      calculateLine: jest.fn(async ({ line }: any) => ({
        line,
        netAmount: (line.unitPriceNet ?? 0) * line.quantity,
        grossAmount: (line.unitPriceGross ?? 0) * line.quantity,
        taxAmount: 0,
        discountAmount: 0,
        adjustments: [],
      })),
      calculateDocumentTotals: jest.fn(async ({ lines }: any) => makeDocumentTotalsFixture(lines)),
    }),
    catalogScopedProductService: asValue(makeCatalogScopedProductService()),
  })
  registerPromotionsDi(container)
  container.register({
    promotionCacheService: asValue({ getActivePromotions: async () => [buildRealMatchingPromotion()] }),
  })

  return { container, commandBus }
}

// `reauthorProposalForMergeRetarget`'s own best-effort cleanup paths (a lost idempotency
// CAS, an orphaned successor) dispatch `cart.proposal.reject` for a successor it just
// created, not for the old proposal's own cart — a real command id this suite's own happy
// path never needs, but the real `CommandBus` must still resolve it rather than logging a
// "handler not registered" error if some other test running in-process ever registers it
// twice. Nothing to stand in here: `cart.proposal.create`/`.reject` are both now the real
// handlers, registered by the side-effect import above.

describe('handleCartMergedForAssistedSellingReauthor — real promotions DI scope (M1 re-review)', () => {
  beforeEach(() => {
    seededCarts = [makeTargetCartFixture(), makeOldProposalCartFixture()]
    seededCartLines = []
    seededProducts = [makeProductFixture()]
    seededCartPromotionApplications = []
    lineIdCounter = 0
    applicationIdCounter = 0
  })

  test('re-authors under the real container, with the real evaluation engine applying an actual promotion to an actual cart line, and links the original proposal to its successor', async () => {
    const { em, proposals } = makeFakeEm()
    const { container } = buildRealContainerAndCommandBus(em)
    const realPromotionsService = container.resolve<PromotionsService>('promotionsService')
    const evaluateSpy = jest.spyOn(realPromotionsService, 'evaluate')

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload(), {
      resolve: container.resolve.bind(container),
      container: container as any,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })

    // Re-authored, never superseded without a successor — the scope-required 400 the M1
    // regression would throw (and `retargetOrSupersedeOneProposal`'s fallback would swallow
    // into a supersede with no successor) never happened, because the real container reached
    // `promotionsService` through the REAL `cart.proposal.create` handler, not a stand-in.
    expect(proposals[0].status).toBe('superseded')
    expect(proposals[0].supersededByProposalId).not.toBeNull()

    // The real evaluation engine actually matched the real promotion and computed a real
    // discount against the real cart line this suite created — not just "evaluate() didn't
    // throw".
    expect(evaluateSpy).toHaveBeenCalledTimes(1)
    const evaluated = await evaluateSpy.mock.results[0]!.value
    expect(evaluated.appliedPromotions).toHaveLength(1)
    expect(evaluated.appliedPromotions[0].promotionId).toBe('promo-real-1')
    expect(evaluated.appliedPromotions[0].effects[0]).toMatchObject({ type: 'CART_DISCOUNT' })
    // 2 x 60.00 gross = 120.00, 10% off = -12.00 — genuinely computed from this suite's own
    // cart line, not a canned zero.
    expect(Number(evaluated.appliedPromotions[0].effects[0].amountGross)).toBeCloseTo(-12, 2)

    // The successor proposal cart really exists, carries the applied promotion, and really
    // has the one real line this suite's `cartService.getProposalCartLines` handed back.
    const successorCartId = proposals[0].supersededByProposalId
      ? seededCarts.find((cart) => cart.kind === 'proposal' && cart.proposedToCartId === NEW_TARGET_ID)?.id
      : null
    expect(successorCartId).toBeTruthy()
    expect(seededCartLines.filter((line) => line.cartId === successorCartId)).toHaveLength(1)
    expect(seededCartPromotionApplications.filter((application) => application.cartId === successorCartId)).toHaveLength(1)
  })

  test('the real cart.proposal.create handler throws the scope-required 400 if `auth` never reaches the real promotionsService (sanity check on the fixture itself)', async () => {
    const { em } = makeFakeEm()
    const { container } = buildRealContainerAndCommandBus(em)
    const commandBus = container.resolve<CommandBus>('commandBus')

    // A container that `.register()`s `auth` on a DIFFERENT object (the exact pre-fix shape
    // `buildScopedContainerFromResolve` produced) never reaches `promotionsService`'s own
    // closure over THIS container — proving the fixture itself actually exercises the fail-
    // closed path the M1 fix prevents, not merely tautologically implementing a stub that
    // always succeeds.
    const overlay = { resolve: container.resolve.bind(container), register: () => undefined }
    await expect(
      commandBus.execute(CART_PROPOSAL_CREATE_COMMAND_ID, {
        input: {
          targetCartId: NEW_TARGET_ID,
          lines: [CART_LINE],
          routeContext: { assortmentScope: null },
        },
        ctx: { auth: { sub: AUTHOR_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID }, selectedOrganizationId: ORG_ID, container: overlay } as any,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})
