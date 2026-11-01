import type { CustomerGroupsService } from '@open-mercato/core/modules/customer_groups/services/customerGroupsService'
import type { ApprovalView } from '@open-mercato/core/modules/customer_groups/services/customerPurchaseApprovalService'
import type { Cart } from '../data/entities'

// Step 3.1 (K1/K2, §9a.1/§9a.2) — the approval gate's own pure math and its one soft-DI
// read, shared by `lib/reprice.ts`'s totals phase (every command that changes
// `Cart.totals`) and `commands/lock.ts`'s fresh-terms recompute at `cart.lock`. Kept out of
// both call sites so the §9a.2 formula has exactly one implementation to test and to read.

/**
 * `customer_groups` is a HARD `requires` of `cart` (`index.ts`), so this is always
 * resolvable in a real deployment — resolved defensively anyway, the same soft-DI shape
 * `lib/adminCartScope.ts#tryResolveCustomerPurchaseApprovalService` already uses for its
 * sibling service, per this Step's own brief. When absent, the documented degrade is
 * "`requiresApproval` always computes `false`" (see `resolveCartRequiresApproval` below) —
 * never a thrown error, and never a gate a guest/identified buyer cannot pass because a
 * peer module happened to be missing.
 */
export function tryResolveCustomerGroupsService(container: {
  resolve: <T = unknown>(name: string) => T
}): CustomerGroupsService | null {
  try {
    return container.resolve<CustomerGroupsService>('customerGroupsService') ?? null
  } catch {
    return null
  }
}

/**
 * K1: the one amount basis — `totals.grandTotalGrossAmount` (goods after promotions,
 * excluding delivery, §9a.1). `Cart.totals` is stored as the verbatim
 * `SalesDocumentCalculationResult.totals` jsonb snapshot (§3.2); this never rounds or
 * re-derives it, only parses the one field back out. `0` for a missing/non-numeric value
 * (e.g. a brand-new cart's `EMPTY_CART_TOTALS` placeholder) — never `NaN`, which would make
 * every downstream `>` comparison silently false.
 */
export function computeGoodsGrossAmount(totals: Record<string, unknown> | null | undefined): number {
  const raw = totals && typeof totals === 'object' ? (totals as Record<string, unknown>).grandTotalGrossAmount : undefined
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * §9a.2's literal formula: `requires_approval = threshold set AND (currency mismatch OR
 * goods gross > threshold)`. Currency mismatch subsumes a `null` `termsCurrencyCode` (no
 * group in the chain set one and the organization has no base currency, D-R5-4/D-R5-37) —
 * `null !== cartCurrencyCode` is always true, so that case already falls out of the plain
 * inequality without a separate `== null` branch.
 */
export function computeRequiresApproval(input: {
  approvalRequiredAbove: number | null
  termsCurrencyCode: string | null
  cartCurrencyCode: string
  goodsGrossAmount: number
}): boolean {
  if (input.approvalRequiredAbove == null) return false
  if (input.termsCurrencyCode !== input.cartCurrencyCode) return true
  return input.goodsGrossAmount > input.approvalRequiredAbove
}

/**
 * Step 3.2 (§9a.3/§9a.4/§10.1) — the ONE qualification formula every reader of a cart's
 * approval shares: `cart.lock`'s gate check (§9a.3 step 3), `cart.approval.request`'s own
 * "does the CURRENT approval already cover this cart" pre-check (§9a.4 step 2), and the
 * `CartView.approval.qualifies` field (§10.1) all ask the identical question — approved,
 * same currency as the cart, amount still covers the current goods gross. Extracted here
 * (not duplicated per call site) for the same reason `computeRequiresApproval` already is:
 * one implementation to test and to read.
 */
export function approvalQualifies(input: {
  approval: Pick<ApprovalView, 'status' | 'currencyCode' | 'amountGross'> | null
  cartCurrencyCode: string
  goodsGrossAmount: number
}): boolean {
  const { approval, cartCurrencyCode, goodsGrossAmount } = input
  return (
    !!approval &&
    approval.status === 'approved' &&
    approval.currencyCode === cartCurrencyCode &&
    Number(approval.amountGross) >= goodsGrossAmount
  )
}

export type CartForApprovalGate = Pick<
  Cart,
  'tenantId' | 'organizationId' | 'customerId' | 'customerIds' | 'currencyCode'
>

/**
 * §9a.1: "Terms are resolved by `customerGroupsService.resolveTerms({ customerIds:
 * cart.customerIds, tenantId })` for the cart's own buyer identity, so every channel is
 * covered (D-R5-29)." `organizationId` is passed too (additive on `resolveTerms`'s own
 * input, Step 3.1) so D-R5-37's base-currency fallback can resolve against the cart's
 * organization. No `groupIds` is passed — group membership is re-resolved fresh every call,
 * matching §9a.2's "recomputes it from fresh terms" requirement rather than trusting a
 * caller-supplied, possibly-stale group list.
 */
export async function resolveCartRequiresApproval(
  container: { resolve: <T = unknown>(name: string) => T },
  cart: CartForApprovalGate,
  goodsGrossAmount: number,
): Promise<boolean> {
  const service = tryResolveCustomerGroupsService(container)
  if (!service) return false
  const terms = await service.resolveTerms({
    customerId: cart.customerId ?? null,
    customerIds: cart.customerIds ?? [],
    tenantId: cart.tenantId,
    organizationId: cart.organizationId,
  })
  return computeRequiresApproval({
    approvalRequiredAbove: terms.approvalRequiredAbove,
    termsCurrencyCode: terms.termsCurrencyCode,
    cartCurrencyCode: cart.currencyCode,
    goodsGrossAmount,
  })
}
