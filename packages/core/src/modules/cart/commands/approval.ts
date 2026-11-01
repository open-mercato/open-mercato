import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerPurchaseApprovalServiceError } from '@open-mercato/core/modules/customer_groups/services/customerPurchaseApprovalService'
import { E } from '#generated/entities.ids.generated'
import { Cart } from '../data/entities'
import { assertCartNotLocked } from '../lib/lockGuard'
import { recordBasketMutationActivity } from '../lib/cartActivity'
import { approvalQualifies, computeGoodsGrossAmount, resolveCartRequiresApproval } from '../lib/approvalGate'
import { tryResolveCustomerPurchaseApprovalService } from '../lib/adminCartScope'
import { emitCartEvent } from '../events'
import { toCartSummary } from './cart'
import type { CartSummary } from './cart'

// Step 3.2 (K3, K4, K7, §9a.4) — `cart.approval.request`, the one and only way a cart's
// approval is created (§9a.4's own text: "There is no public create route in
// `customer_groups`"). Mirrors `commands/promotions.ts`'s own `loadMutableCart` exactly
// (duplicated at this file's own small scope, the established precedent every command
// file in this module already follows rather than importing another file's private
// helper) — the ONE difference from that shared shape is this command's own guest
// refusal, which runs AFTER the generic status gate and BEFORE anything approval-specific.

type CartApprovalScope = { tenantId: string; organizationId: string }

const CART_ENTITY_ID = E.cart.cart
const cartCrudIndexer: CrudIndexerConfig<Cart> = { entityType: CART_ENTITY_ID }
const cartCrudEvents: CrudEventsConfig<Cart> = {
  module: 'cart',
  entity: 'cart',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

function getCartIdentifiers(cart: Cart) {
  return { id: cart.id, organizationId: cart.organizationId, tenantId: cart.tenantId }
}

/**
 * Same shape as `commands/promotions.ts`/`commands/lines.ts`'s own `loadMutableCart`:
 * `423 cart_locked` first (never folded into the no-oracle collapse, §9), the §9
 * "any mutation" reactivation of an `abandoned` basket, then the generic `409
 * cart_not_active` for every other non-active status (§9a.4 step 1: "merged/expired/
 * converted → 409 cart_not_active").
 */
async function loadMutableCart(em: EntityManager, scope: CartApprovalScope, cartId: string): Promise<Cart> {
  const cart = await findOneWithDecryption(
    em,
    Cart,
    { id: cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
    {},
    scope,
  )
  if (!cart) throw notFound('[internal] cart not found')
  assertCartNotLocked(cart)
  await recordBasketMutationActivity(em, cart)
  if (cart.status !== 'active') {
    throw new CrudHttpError(409, { error: '[internal] cart_not_active', code: 'cart_not_active', status: cart.status })
  }
  return cart
}

export type CartRequestApprovalInput = {
  cartId: string
  tenantId: string
  organizationId: string
}

export type CartRequestApprovalResult = {
  cart: CartSummary
  approvalId: string
  created: boolean
}

const requestApprovalCommand: CommandHandler<CartRequestApprovalInput, CartRequestApprovalResult> = {
  id: 'cart.approval.request',
  isUndoable: false,
  async execute(input, ctx) {
    const scope: CartApprovalScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await loadMutableCart(em, scope, input.cartId)

    // §9a.4 step 1 / K4: "requires `routeContext.customerUserId`... a guest cannot
    // request approval." The route's own identity binding (§8.4) already guarantees that
    // whenever `cart.customerUserId` IS set, the caller presented that buyer's own
    // session — this check is the guest case itself, not a re-check of that binding.
    if (!cart.customerUserId) {
      throw new CrudHttpError(409, {
        error: '[internal] approval_requires_identified_buyer',
        code: 'approval_requires_identified_buyer',
      })
    }

    const approvalService = tryResolveCustomerPurchaseApprovalService(ctx.container)
    if (!approvalService) {
      throw new CrudHttpError(503, {
        error: '[internal] customer_groups approval service unavailable',
        code: 'approval_service_unavailable',
      })
    }

    // §9a.2/§9a.4 step 2: recomputed from FRESH terms, never trusting the persisted
    // `requires_approval` flag (display-only, §9a.2's own text). Never written back here —
    // this route does not change totals, so the stored flag is left for the next
    // totals-changing command (or `cart.lock`) to resync.
    const goodsGrossAmount = computeGoodsGrossAmount(cart.totals)
    const requiresApproval = await resolveCartRequiresApproval(ctx.container, cart, goodsGrossAmount)

    const existingApproval = cart.approvalId
      ? await approvalService.getApproval({ scope, approvalId: cart.approvalId })
      : null

    // §9a.4 step 2: "A current approval that already qualifies is also 409
    // approval_not_required" — there is nothing left to request.
    const currentlyQualifies = approvalQualifies({ approval: existingApproval, cartCurrencyCode: cart.currencyCode, goodsGrossAmount })
    if (!requiresApproval || currentlyQualifies) {
      throw new CrudHttpError(409, { error: '[internal] approval_not_required', code: 'approval_not_required' })
    }

    // §9a.4 step 3: a still-pending, still-covering approval is returned as-is — idempotent
    // while pending (G8 is the service's own authority for this; this is the cart-side
    // pre-check that decides whether to even call it again).
    if (existingApproval && existingApproval.status === 'pending') {
      const pendingCovers =
        existingApproval.currencyCode === cart.currencyCode && Number(existingApproval.amountGross) >= goodsGrossAmount
      if (pendingCovers) {
        return { cart: toCartSummary(cart), approvalId: existingApproval.id, created: false }
      }
      // The pending approval no longer covers the cart (totals rose again while it was
      // still pending) — withdraw it first, REQUESTER-initiated (not the `system` actor
      // `lib/approvalLifecycle.ts#withdrawPendingCartApproval` uses for merge/expire/
      // purge): the buyer re-requesting their OWN stale request is `withdrawnReason:
      // 'requester'`, not a cart-lifecycle cleanup. `customerEntityId` is required by the
      // type but unused by `withdrawApproval`'s own requester-match check (actorType +
      // actorId only) — see `customerPurchaseApprovalService.ts`'s own `withdrawApproval`.
      try {
        await approvalService.withdrawApproval({
          scope,
          approvalId: existingApproval.id,
          actor: { actorType: 'customer_user', actorId: cart.customerUserId, customerEntityId: cart.customerId ?? '' },
        })
      } catch (err) {
        const isAlreadySettled = err instanceof CustomerPurchaseApprovalServiceError && err.code === 'approval_not_pending'
        if (!isAlreadySettled) throw err
      }
    }

    const customerIds = cart.customerIds && cart.customerIds.length > 0
      ? cart.customerIds
      : cart.customerId
        ? [cart.customerId]
        : []
    const requestResult = await approvalService.requestApproval({
      scope,
      buyer: { customerIds },
      // `customerEntityId` is required by `ApprovalActor`'s type but, same as the withdraw
      // actor above, not independently trusted by the service for a `requestApproval` call
      // either — `buyer.customerIds` is what `resolveCompanyFirstCustomerId` actually
      // resolves the approval's own `customerId` from (G11).
      requestedBy: { actorType: 'customer_user', actorId: cart.customerUserId, customerEntityId: cart.customerId ?? '' },
      subjectType: 'cart',
      subjectId: cart.id,
      amountGross: String(goodsGrossAmount),
      currencyCode: cart.currencyCode,
    })

    const now = new Date()
    await withAtomicFlush(
      em,
      [
        () => {
          cart.approvalId = requestResult.approval.id
          cart.awaitingApprovalSince = now
        },
      ],
      { transaction: true, label: 'cart.approval.request' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: cart,
      identifiers: getCartIdentifiers(cart),
      events: cartCrudEvents,
      indexer: cartCrudIndexer,
    })

    // K7/§11: the full rev-10 payload (`customerId`/`customerUserId` included — the
    // Release-5 spec text grows this past the narrower 6-field shape the pre-revision
    // analysis finding named). Emitted only when a NEW approval was created — an
    // idempotent repeat through `requestApproval`'s own G8 guard "emits nothing" (§11).
    if (requestResult.created) {
      await emitCartEvent('cart.approval.requested', {
        cartId: cart.id,
        approvalId: requestResult.approval.id,
        tenantId: cart.tenantId,
        organizationId: cart.organizationId,
        customerId: requestResult.approval.customerId,
        customerUserId: cart.customerUserId,
        amountGross: requestResult.approval.amountGross,
        currencyCode: requestResult.approval.currencyCode,
      })
    }

    return { cart: toCartSummary(cart), approvalId: requestResult.approval.id, created: requestResult.created }
  },
}

registerCommand(requestApprovalCommand)

export { requestApprovalCommand }
