import { asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CodeReservation, Promotion, Rule } from '@open-mercato/core/modules/promotions/data/entities'
import type { CodeReservationResult, PromotionsService } from '@open-mercato/core/modules/promotions/lib/types'
import { Cart, CartLine, CartPromotionApplication } from '../data/entities'
import type { ResolvedCartRouteContext } from '../lib/routeContext'
import { assertCartNotLocked } from '../lib/lockGuard'
import { emitCartEvent } from '../events'
import type { CartPriceChange } from '../lib/reprice'
import type { CartPromotionWarning } from '../lib/promotionContext'
import { repriceCartCommand } from './cart'
import type { CartRepriceInput, CartRepriceResult } from './cart'

// Step 7.2 — §3.1a's `cart.promotions.apply` / `cart.promotions.remove`, the code
// application and reservation lifecycle. Builds on Step 7.1's `buildPromotionsEffectsPhase`
// (`lib/promotionContext.ts`) — read that file's own header comment and its sync-loop
// comment first; this file is the OTHER half of the "key design decision" documented there
// (how a just-applied code's placeholder row gets into the next `cart.reprice`'s `codes`
// list before that phase ever reads `CartPromotionApplication`).
//
// Neither command is in §3.1a's undo table (only `.lines.*` and `.merge` carry undo) — read
// as deliberate, the same "not every mutation needs undo" precedent `cart.lines.update`/
// `cart.reprice` already document for themselves, not an oversight. No `undo` handler on
// either command below.

type CartPromotionsScope = { tenantId: string; organizationId: string }

function codeReservationUnavailableError(): CrudHttpError {
  // §15a: `code_reservation_unavailable` / 409. Every `promotionsService.reserveCode()`
  // failure collapses to this ONE cart-level code — never promotions' own
  // `code_invalid`/`code_requires_identified_customer` vocabulary (`promotions/lib/
  // code-service.ts`), which is an implementation detail of HOW the code became unusable,
  // not something cart's public contract re-exposes. The spec names this mapping only for
  // the budget/per-customer-limit case; this command applies it uniformly so there is one
  // error surface for "this code did not work" — documented judgment call (Step 7.2).
  return new CrudHttpError(409, { error: '[internal] code_reservation_unavailable', code: 'code_reservation_unavailable' })
}

// Step 7.5 — adds the SAME 423-for-locked distinction every other command file in this
// module now applies (`commands/lines.ts`'s `loadMutableCart`, `commands/merge.ts`'s inline
// target-cart check), via the shared `assertCartNotLocked` helper. Documented judgment
// call, left deliberately narrow: this function still has NO `requireActive`-shaped generic
// check for any OTHER non-active status (converted/merged/expired/abandoned) — that gap
// predates this step (`cart.promotions.apply`/`.remove` have never rejected a non-active,
// non-locked cart) and is left as-is rather than folded into this change, since widening it
// is a separate, non-lock-related behavior change this step's own scope does not ask for.
async function loadMutableCart(em: EntityManager, scope: CartPromotionsScope, cartId: string): Promise<Cart> {
  const cart = await findOneWithDecryption(
    em,
    Cart,
    { id: cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
    {},
    scope,
  )
  if (!cart) throw notFound('[internal] cart not found')
  assertCartNotLocked(cart)
  return cart
}

/**
 * Resolves which active, non-deleted promotion(s) a code unlocks.
 *
 * NOT `Code.promotionId` — that column does not exist (`promotions/data/entities.ts`'s
 * `Code` has no FK to `Promotion` at all). A code is linked to a promotion only indirectly,
 * through a `Rule` row of `ruleType: 'code'` whose `config.codeId` names this code
 * (`promotions/lib/rule-evaluators.ts`'s `evaluateCode`) — the SAME mechanism `evaluate()`
 * itself uses to decide whether a presented code unlocks a given promotion's rule tree.
 * This mirrors that check at lookup time rather than evaluation time: a plain cross-module
 * read of `Rule`/`Promotion` (FK-id + fetch separately, no ORM relation), the same pattern
 * this module already uses for `CatalogProduct`/`CatalogProductVariant`.
 *
 * Usually resolves to exactly one promotion; a code referenced by more than one promotion's
 * rule tree resolves to all of them (a placeholder `CartPromotionApplication` row is created
 * per promotion in that case — the entity is keyed by promotionId specifically so this is
 * representable without inventing a new column).
 */
async function resolvePromotionIdsForCode(
  em: EntityManager,
  codeId: string,
  scope: CartPromotionsScope,
): Promise<string[]> {
  const codeRules = await em.find(Rule, {
    ruleType: 'code',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const promotionIds = Array.from(
    new Set(codeRules.filter((rule) => rule.config?.codeId === codeId).map((rule) => rule.promotionId)),
  )
  if (promotionIds.length === 0) return []
  const activePromotions = await em.find(Promotion, {
    id: { $in: promotionIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    active: true,
    deletedAt: null,
  })
  return activePromotions.map((promotion) => promotion.id)
}

async function dispatchReprice(
  commandBus: CommandBus,
  ctx: CommandRuntimeContext,
  scope: CartPromotionsScope,
  cartId: string,
  trigger: CartRepriceInput['trigger'],
  routeContext: ResolvedCartRouteContext | undefined,
): Promise<CartRepriceResult> {
  const repriceInput: CartRepriceInput = {
    cartId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    trigger,
    routeContext,
  }
  const { result } = await commandBus.execute<CartRepriceInput, CartRepriceResult>(repriceCartCommand.id, {
    input: repriceInput,
    ctx,
  })
  return result
}

function toApplyResult(result: CartRepriceResult): CartPromotionsCommandResult {
  return {
    cart: result.cart,
    priceChanges: result.priceChanges,
    ...(result.warnings && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  }
}

export type CartPromotionsCommandResult = {
  cart: CartRepriceResult['cart']
  priceChanges: CartPriceChange[]
  warnings?: CartPromotionWarning[]
}

// ---------------------------------------------------------------------------
// cart.promotions.apply
// ---------------------------------------------------------------------------

export type CartPromotionsApplyInput = {
  cartId: string
  tenantId: string
  organizationId: string
  /** The route-edge-resolved buyer context, forwarded to `cart.reprice`'s own dispatch for
   * the gift-line assortment check (§6a.1b) — never read for anything else here. */
  routeContext?: ResolvedCartRouteContext
  codeString: string
}

const applyPromotionCommand: CommandHandler<CartPromotionsApplyInput, CartPromotionsCommandResult> = {
  id: 'cart.promotions.apply',
  isUndoable: false,
  async execute(input, ctx) {
    const scope: CartPromotionsScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await loadMutableCart(em, scope, input.cartId)

    // Step 7.1's own convention (`commands/cart.ts`'s `cart.reprice`): register BEFORE
    // resolving `promotionsService`, since `reserveCode()`/`extendReservation()` resolve
    // their own tenant/org scope off whatever is registered under the `auth` DI token
    // (`promotions/lib/promotions-service.ts`).
    ctx.container.register({ auth: asValue({ tenantId: cart.tenantId, orgId: cart.organizationId }) })
    const promotionsService = ctx.container.resolve<PromotionsService>('promotionsService')

    let reserved: CodeReservationResult
    try {
      reserved = await promotionsService.reserveCode({
        codeString: input.codeString,
        cartId: cart.id,
        customerId: cart.customerId ?? null,
      })
    } catch {
      throw codeReservationUnavailableError()
    }

    const promotionIds = await resolvePromotionIdsForCode(em, reserved.codeId, scope)
    if (promotionIds.length === 0) {
      // The code itself is valid (reservation succeeded) but no active promotion's rule
      // tree references it — a data/authoring gap, not a buyer error. Release the
      // reservation just taken rather than leak one for a code that can never produce a
      // discount, and report the same uniform 409 (documented judgment call, Step 7.2 —
      // neither the spec nor SPEC-055 names this specific edge case).
      await promotionsService.releaseCode(reserved.codeId, cart.id)
      throw codeReservationUnavailableError()
    }

    // `reserveCode()`'s own public contract (`CodeReservationResult`) carries no
    // reservation ROW id (only `codeId`/`type`) — resolved here with a direct read,
    // keyed `(codeId, cartId)` the same unique pair `code-service.ts`'s own
    // `upsertReservation` enforces, so this always finds the row `reserveCode` just
    // created or extended.
    const reservationRow = await em.findOne(CodeReservation, {
      codeId: reserved.codeId,
      cartId: cart.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const codeReservationId = reservationRow?.id ?? null

    const now = new Date()
    const createdPromotionIds: string[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          // THE KEY DESIGN DECISION (full reasoning lives on `lib/promotionContext.ts`'s
          // sync loop): persisted HERE, in `cart.promotions.apply`'s own transaction,
          // BEFORE the `cart.reprice` dispatch below runs. By the time that dispatch's
          // `buildPromotionsEffectsPhase` reads `CartPromotionApplication` for this cart,
          // this placeholder row already exists, so the just-applied code is already in
          // the `codes` list `evaluate()` receives on its very first evaluation — no
          // separate "stage the code, then evaluate" handshake, just normal read-after-
          // commit ordering between two independent command dispatches.
          const existingForCode = (await findWithDecryption(
            em,
            CartPromotionApplication,
            { cartId: cart.id, codeId: reserved.codeId, tenantId: scope.tenantId, organizationId: scope.organizationId },
            {},
            scope,
          )) as CartPromotionApplication[]
          const existingPromotionIds = new Set(existingForCode.map((application) => application.promotionId))

          for (const promotionId of promotionIds) {
            // Idempotent per (cart, code) — a double-click or a replayed apply with no
            // `Idempotency-Key` (§8.2's header is NOT wired on this route, see the route
            // file's own comment) must not create a second placeholder row; `reserveCode`
            // itself is already idempotent per `(code, cart)` (§Code Lifecycle), and this
            // mirrors that at the application-row layer.
            if (existingPromotionIds.has(promotionId)) continue
            const application = em.create(CartPromotionApplication, {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              cartId: cart.id,
              promotionId,
              code: input.codeString,
              codeId: reserved.codeId,
              codeType: reserved.type,
              codeReservationId,
              // A safe default per the task brief: this placeholder carries no effect yet
              // (that is `cart.reprice`'s job), so there is no line to attribute it to.
              scope: 'order' as const,
              cartLineId: null,
              effect: {},
              amountNet: null,
              amountGross: null,
              appliedAt: now,
            })
            em.persist(application)
            createdPromotionIds.push(promotionId)
          }
        },
      ],
      { transaction: true, label: 'cart.promotions.apply' },
    )

    for (const promotionId of createdPromotionIds) {
      await emitCartEvent('cart.promotion.applied', {
        cartId: cart.id,
        tenantId: cart.tenantId,
        organizationId: cart.organizationId,
        promotionId,
        codeId: reserved.codeId,
      })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const repriceResult = await dispatchReprice(commandBus, ctx, scope, cart.id, 'promotion_applied', input.routeContext)

    return toApplyResult(repriceResult)
  },
}

// ---------------------------------------------------------------------------
// cart.promotions.remove
// ---------------------------------------------------------------------------

export type CartPromotionsRemoveInput = {
  cartId: string
  tenantId: string
  organizationId: string
  routeContext?: ResolvedCartRouteContext
  /** The spec's `DELETE /current/promotions/[id]` never defines what `[id]` is anywhere
   * else (checked) — this command reads it as a `promotionId`: `CartPromotionApplication`
   * is keyed by promotion, not by its own row id or by `codeId`, and a buyer-facing
   * "applied promotions" list naturally shows promotions, not internal row ids
   * (documented judgment call, Step 7.2). */
  promotionId: string
}

const removePromotionCommand: CommandHandler<CartPromotionsRemoveInput, CartPromotionsCommandResult> = {
  id: 'cart.promotions.remove',
  isUndoable: false,
  async execute(input, ctx) {
    const scope: CartPromotionsScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await loadMutableCart(em, scope, input.cartId)

    const applications = (await findWithDecryption(
      em,
      CartPromotionApplication,
      { cartId: cart.id, promotionId: input.promotionId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )) as CartPromotionApplication[]
    // Mirrors `cart.lines.remove`'s own "already idempotent in effect" treatment
    // (`commands/lines.ts`): removing a promotion that was never applied, or was already
    // removed, 404s the same as removing a line that never existed — never a silent 200.
    if (applications.length === 0) throw notFound('[internal] promotion not applied to this cart')

    const codeIds = Array.from(
      new Set(applications.map((application) => application.codeId).filter((id): id is string => !!id)),
    )

    // §6a's own gift-line convention: a removed promotion's gift line cannot survive the
    // removal. The forthcoming `cart.reprice` dispatch would also drop it (its promotion is
    // gone from `appliedPromotions`), but removing it eagerly here means THIS command's own
    // response — before that dispatch even runs — never shows a gift line for a promotion
    // the buyer just removed.
    const giftLines = (await findWithDecryption(
      em,
      CartLine,
      { cartId: cart.id, origin: 'promotion', promotionId: input.promotionId, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )) as CartLine[]

    const now = new Date()
    await withAtomicFlush(
      em,
      [
        () => {
          for (const application of applications) em.remove(application)
          for (const giftLine of giftLines) giftLine.deletedAt = now
        },
      ],
      { transaction: true, label: 'cart.promotions.remove' },
    )

    // Cross-module side effect — run AFTER the local commit above, matching this file's
    // "side effects after commit" discipline: releasing a reservation on `promotions`' own
    // state before the local transaction commits would leave the two modules inconsistent
    // if the flush failed (code released, but the cart still showed the promotion applied).
    if (codeIds.length > 0) {
      ctx.container.register({ auth: asValue({ tenantId: cart.tenantId, orgId: cart.organizationId }) })
      const promotionsService = ctx.container.resolve<PromotionsService>('promotionsService')
      // §6: "release happens by cartId on cart expiry, abandonment or code removal."
      for (const codeId of codeIds) {
        await promotionsService.releaseCode(codeId, cart.id)
      }
    }

    for (const giftLine of giftLines) {
      await emitCartEvent('cart.line.removed', {
        id: giftLine.id,
        cartId: giftLine.cartId,
        organizationId: giftLine.organizationId,
        tenantId: giftLine.tenantId,
      })
    }
    await emitCartEvent('cart.promotion.removed', {
      cartId: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
      promotionId: input.promotionId,
    })

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const repriceResult = await dispatchReprice(commandBus, ctx, scope, cart.id, 'promotion_removed', input.routeContext)

    return toApplyResult(repriceResult)
  },
}

registerCommand(applyPromotionCommand)
registerCommand(removePromotionCommand)

export { applyPromotionCommand, removePromotionCommand }
