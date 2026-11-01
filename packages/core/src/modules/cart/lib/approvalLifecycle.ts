import {
  CustomerPurchaseApprovalServiceError,
  type CustomerPurchaseApprovalService,
} from '@open-mercato/core/modules/customer_groups/services/customerPurchaseApprovalService'

// Step 3.2 (K3, §7.4/§9/§9a.4/§12 as revised) — the ONE call every cart-initiated,
// system-actor approval withdrawal shares: merge (source side, §7.4), `expire-carts` and
// `purge-expired-carts` (§12) all ask the identical question — "does this cart's
// `approval_id` still name a PENDING approval, and if so, withdraw it" — with the same
// idempotent-on-already-settled behaviour (`approval_not_pending` is not an error here;
// per §9a.4's own text, "an approval that is no longer pending counts as already
// settled"). Kept out of every call site (`commands/merge.ts`, `lib/sweepers.ts`) so that
// idempotency rule has exactly one implementation.
//
// Deliberately NOT used by `commands/approval.ts`'s own "re-request supersedes a stale
// pending approval" step — that withdrawal is REQUESTER-initiated (actor `customer_user`,
// stored `withdrawnReason: 'requester'`), not a system cleanup, so it calls
// `withdrawApproval` directly with its own actor shape instead of this helper's `system`
// actor.

// Step 6.1 (K3 gap-fill, §9a.4's "a cart-initiated withdrawal clears both in one step" rule
// applied to the ONE transition the original Step 3.2/3.4 pass missed): a `locked` cart
// converted via the QUOTE outcome (`salesQuoteId`) is not the "approved order went through"
// case §9a.4 already covers — a `SalesQuote` is not yet a commitment, so a still-`pending`
// approval left on that cart would otherwise dangle forever. The ORDER outcome
// (`salesOrderId`) deliberately has NO member here — per K3's own table an approved-order
// conversion leaves an `approved` approval exactly as is, and `markConverted`'s own call
// below only ever withdraws a still-`pending` one anyway (idempotent no-op otherwise).
export type CartApprovalWithdrawReason =
  | 'cart_merged'
  | 'cart_expired'
  | 'cart_purged'
  | 'cart_converted_as_quote'

export type CartForApprovalWithdrawal = {
  tenantId: string
  organizationId: string
  approvalId?: string | null
}

/**
 * Attempts a `system`-actor withdrawal of `cart.approvalId`'s approval. Returns `true`
 * only when THIS call actually transitioned a `pending` approval to `withdrawn` — the
 * caller uses that to decide whether to also clear `Cart.awaitingApprovalSince` in the
 * SAME write as its own lifecycle transition (merge/expire/purge), per §7.4/§9a.4: a
 * cart-initiated withdrawal clears both in one step, rather than waiting for the §9a.5
 * event-driven subscriber's own (idempotent, but asynchronous) pass.
 *
 * `false` for every "nothing to do" case: no `approvalId`, no resolvable
 * `customerPurchaseApprovalService` (soft dependency, same degrade every other optional
 * read in this module already documents), or an approval that is no longer `pending`
 * (already approved/rejected/expired/withdrawn by someone else — the §9a.5 subscriber
 * already cleared `awaitingApprovalSince` for that transition, so there is nothing left
 * for this call to clear either).
 */
export async function withdrawPendingCartApproval(
  approvalService: CustomerPurchaseApprovalService | null,
  cart: CartForApprovalWithdrawal,
  reason: CartApprovalWithdrawReason,
): Promise<boolean> {
  if (!approvalService || !cart.approvalId) return false
  try {
    await approvalService.withdrawApproval({
      scope: { tenantId: cart.tenantId, organizationId: cart.organizationId },
      approvalId: cart.approvalId,
      actor: { actorType: 'system', reason },
    })
    return true
  } catch (err) {
    if (err instanceof CustomerPurchaseApprovalServiceError && err.code === 'approval_not_pending') return false
    throw err
  }
}
