/**
 * #8268 review Major 1 (re-review, M1). `reauthorOnMerge.test.ts` proves the handler passes
 * the REAL `ctx.container` straight through (identity) when the event bus supplies one, and
 * `promotions/__tests__/promotionsDiContainerScope.test.ts` proves `promotionsService` is
 * only visible to a `.register({ auth: ... })` call made on that SAME real container — never
 * a local resolver-overlay shim. Neither proves the two facts TOGETHER: this suite runs the
 * REAL `reauthorProposalForMergeRetarget` (never mocked here, unlike every test in
 * `reauthorOnMerge.test.ts`) through a real `cart.proposal.create` dispatch, against the
 * real `promotions/di.ts` registration, with an actual cart line and an actual promotion
 * code — the exact gap the M1 re-review named.
 *
 * `cart.proposal.create`'s own full pricing/visibility machinery (`cart/commands/proposal.ts`)
 * is a stand-in registered under its real command id — same precedent as
 * `order-usage-lifecycle-undo-redelivery.integration.test.ts`'s `sales_orders` stand-in table
 * for a cross-module dependency this suite does not otherwise need. What stays real end to
 * end: the subscriber (`handleCartMergedForAssistedSellingReauthor`), `performAuthorProposal`'s
 * full §6.3 sequence, the real `CommandBus` dispatch, and `promotions/di.ts`'s own
 * `promotionsService` registration plus the real evaluation engine underneath it (only
 * `promotionCacheService` is swapped for a fixture, mirroring
 * `promotionsDiContainerScope.test.ts`'s own `buildRealContainer()`).
 *
 * If the subscriber ever regresses to wrapping `ctx.container` in the local resolver-overlay
 * shim instead of passing it straight through, `promotionsService.evaluate()`'s own
 * `resolvePromotionsServiceScope` fails closed (400, scope required): the stand-in
 * `cart.proposal.create` handler's call to it throws, `performAuthorProposal` throws,
 * `retargetOrSupersedeOneProposal`'s own documented fallback catches it and supersedes the
 * proposal instead of re-authoring it — so this suite's "re-authors, applying the real
 * promotion" assertions fail.
 */
import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { register as registerPromotionsDi } from '@open-mercato/core/modules/promotions/di'
import type { NormalizedPromotion, PromotionsService } from '@open-mercato/core/modules/promotions/lib/types'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import {
  AssistedSellingProposal,
  AssistedSellingStoreSettings,
  AssistedSellingThread,
} from '../../data/entities'
import {
  CART_PROPOSAL_CREATE_COMMAND_ID,
  CART_PROPOSAL_REJECT_COMMAND_ID,
  type CartProposalCreateCommandInput,
  type CartProposalCreateCommandResult,
  type CartProposalRejectCommandInput,
  type CartProposalRejectCommandResult,
} from '../cartProposalCommands'
import { handleCartMergedForAssistedSellingReauthor } from '../reauthorOnMerge'

type Row = Record<string, any>

const TENANT_ID = 'tenant-real-promo-1'
const ORG_ID = 'org-real-promo-1'
const STORE_ID = 'store-real-promo-1'
const OLD_TARGET_ID = 'cart-old-target-real-promo'
const NEW_TARGET_ID = 'cart-new-target-real-promo'
const AUTHOR_USER_ID = 'rep-user-real-promo-1'
const THREAD_ID = 'thread-real-promo-1'
const PROPOSAL_CART_ID = 'proposal-cart-real-promo-1'
const PROMO_CODE_ID = 'promo-code-real-1'

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => (row[key] ?? null) === (value ?? null))
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
const CART_LINE = { productId: 'product-real-promo-1', variantId: null, quantity: '2', configuration: null }
const LINE_UNIT_PRICE_NET = '50.0000'
const LINE_UNIT_PRICE_GROSS = '60.0000'

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
    find: async (Cls: unknown, where: Row) => {
      const rows = Cls === AssistedSellingProposal ? proposals : []
      return rows.filter((row) => matches(row, where))
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
                : []
      return rows.find((row) => matches(row, where)) ?? null
    },
    create: (Cls: unknown, data: Row) => {
      const row = { ...data }
      if (Cls === require('../../data/entities').AssistedSellingParticipant) participants.push(row)
      return row
    },
    persist: () => undefined,
    flush: async () => undefined,
    begin: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    isInTransaction: () => false,
    nativeUpdate: async (Cls: unknown, where: Row, data: Row) => {
      const rows = Cls === AssistedSellingProposal ? proposals : []
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

/** The simplest real rule/benefit pairing — a `code` rule plus an order-level `cart_discount`
 * benefit — mirroring `evaluation-engine.test.ts`'s own `matchingPromotion` precedent. With
 * real cart-line items (unlike that file's empty-items fixtures) the 10% discount computes
 * against this suite's own actual line, not a zero subtotal. */
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
      rules: [{ type: 'code', config: { codeId: PROMO_CODE_ID } }],
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
 * dispatching to a stand-in `cart.proposal.create` that calls the real `promotionsService`,
 * and the assisted_selling-side peers (`em`, `rbacService`, `cartService`,
 * `storeContextService`) this subscriber's own chain resolves by name. */
function buildRealContainerAndCommandBus(em: Row) {
  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  const commandBus = new CommandBus()
  container.register({
    em: asValue(em),
    commandBus: asValue(commandBus),
    rbacService: asValue(makeRbac()),
    cartService: asValue(makeCartService()),
    storeContextService: asValue(makeStoreContextService()),
  })
  registerPromotionsDi(container)
  container.register({
    promotionCacheService: asValue({ getActivePromotions: async () => [buildRealMatchingPromotion()] }),
  })

  return { container, commandBus }
}

// Stand-ins for `cart/commands/proposal.ts`'s real `cart.proposal.create`/`.reject` —
// registered once at module scope (the real `CommandBus` dispatch, like every real
// command, resolves by id against the process-wide registry, never per-container).
//
// `cart.proposal.create`'s own handler mirrors its real counterpart's exact
// `buildCartPromotionsAndTotalsPhases`'s `.register({ auth: ... })` call immediately
// before resolving `promotionsService` (`cart/commands/lines.ts`) — the production
// boundary the M1 fix is about: only a REAL container reaching this point (never a
// resolver-overlay shim) makes that override visible to `promotionsService`'s own
// closure over the container `promotions/di.ts#register` was called with.
const createStandIn: CommandHandler<CartProposalCreateCommandInput, CartProposalCreateCommandResult> = {
  id: CART_PROPOSAL_CREATE_COMMAND_ID,
  isUndoable: false,
  async execute(input, ctx) {
    const container = ctx.container as unknown as { register: (regs: Record<string, unknown>) => void; resolve: <T>(name: string) => T }
    container.register({ auth: asValue({ tenantId: TENANT_ID, orgId: ORG_ID }) })
    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    const line = input.lines[0]
    const { appliedPromotions } = await promotionsService.evaluate({
      items: [
        {
          lineId: 'line-real-promo-1',
          productId: line.productId,
          variantId: line.variantId ?? null,
          quantity: line.quantity,
          unitPriceNet: LINE_UNIT_PRICE_NET,
          unitPriceGross: LINE_UNIT_PRICE_GROSS,
          priceIsPromotional: false,
        },
      ],
      currency: 'USD',
      evaluatedAt: new Date().toISOString(),
      buyer: { customerId: null, customerIds: [], customerGroupIds: [] },
      customerOrderCount: null,
      cartWeight: null,
      codes: [{ id: PROMO_CODE_ID, type: 'static' }],
    })
    return {
      proposalCartId: PROPOSAL_CART_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      lines: [],
      totals: { appliedPromotions },
      rejectedLines: [],
    }
  },
}

// `reauthorProposalForMergeRetarget`'s own best-effort cleanup paths (a lost idempotency
// CAS, an orphaned successor) dispatch `cart.proposal.reject` — harmless no-ops for this
// suite's own happy-path scenarios, but still a real command id the real `CommandBus` must
// resolve rather than logging a "handler not registered" error.
const rejectStandIn: CommandHandler<CartProposalRejectCommandInput, CartProposalRejectCommandResult> = {
  id: CART_PROPOSAL_REJECT_COMMAND_ID,
  isUndoable: false,
  async execute(input) {
    return { proposalCartId: input.proposalCartId, status: 'rejected', alreadyResolved: false }
  },
}

registerCommand(createStandIn)
registerCommand(rejectStandIn)

describe('handleCartMergedForAssistedSellingReauthor — real promotions DI scope (M1 re-review)', () => {
  test('re-authors under the real container, with the real evaluation engine applying an actual promotion code to an actual cart line', async () => {
    const { em, proposals } = makeFakeEm()
    const { container } = buildRealContainerAndCommandBus(em)
    const capturedTotals: Array<Record<string, unknown>> = []
    const realCommandBusExecute = (container.resolve('commandBus') as CommandBus).execute.bind(container.resolve('commandBus'))
    jest.spyOn(container.resolve('commandBus') as CommandBus, 'execute').mockImplementation(async (id: string, options: any) => {
      const outcome = await realCommandBusExecute(id, options)
      if (id === CART_PROPOSAL_CREATE_COMMAND_ID) capturedTotals.push((outcome.result as CartProposalCreateCommandResult).totals)
      return outcome
    })

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload(), {
      resolve: container.resolve.bind(container),
      container: container as any,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })

    // Re-authored, never superseded — the scope-required 400 the M1 regression would throw
    // (and `retargetOrSupersedeOneProposal`'s fallback would swallow into a supersede) never
    // happened, because the real container reached `promotionsService`.
    expect(proposals[0].status).toBe('superseded')
    expect(proposals[0].supersededByProposalId).not.toBeNull()

    // The real evaluation engine actually matched the real code against the real line — not
    // just "evaluate() didn't throw".
    expect(capturedTotals).toHaveLength(1)
    const applied = capturedTotals[0].appliedPromotions as Array<{ promotionId: string; effects: Array<Record<string, unknown>> }>
    expect(applied).toHaveLength(1)
    expect(applied[0].promotionId).toBe('promo-real-1')
    expect(applied[0].effects[0]).toMatchObject({ type: 'CART_DISCOUNT' })
    // 2 x 60.00 gross = 120.00, 10% off = -12.00 — genuinely computed from this suite's own
    // cart line, not a canned zero.
    expect(Number(applied[0].effects[0].amountGross)).toBeCloseTo(-12, 2)
  })

  test('the stand-in cart.proposal.create throws the scope-required 400 if `auth` never reaches the real promotionsService (sanity check on the fixture itself)', async () => {
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
        input: { targetCartId: NEW_TARGET_ID, lines: [CART_LINE] },
        ctx: { container: overlay } as any,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})
