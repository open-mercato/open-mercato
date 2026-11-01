// Step 4.4. `cart` is a hard `requires` of this module (`index.ts`), but its `lib/cartService.ts`
// is still module-private per root AGENTS.md's Cross-Module Coupling guidance (the same reason
// `cart/lib/adminCartScope.ts`'s own header comment gives for NOT importing `customer_groups/
// lib/customerScope.ts` directly: "root AGENTS.md forbids a cross-module import of another
// module's internal `lib/` helper"). This file duck-types the ONE DI surface this module
// actually calls (`cartService`, registered in `cart/di.ts`) — resolved by name through the
// container, never a static value OR type import of `cart`'s own `lib/cartService.ts` —
// mirroring `cart/commands/proposal.ts`'s own `CartProposalCodeServiceLike` precedent for the
// identical situation one module boundary over.

export type AssistedSellingCartSummary = {
  id: string
  tenantId: string
  organizationId: string
  storeId: string | null
  status: string
  customerId: string | null
  customerUserId: string | null
}

export type AssistedSellingProposalCartLine = {
  productId: string
  variantId: string | null
  quantity: string
  configuration: Record<string, unknown> | null
}

/**
 * Step 5.3 (`assisted_selling` §7.1/§7.2, S22). The console's own "the buyer's price,
 * labelled as the buyer's, with `price_row_id` provenance" — read back verbatim off the
 * proposal cart's own `CartLine` rows (`cart`'s fourth additive `cartService` method, after
 * `getForOrganizations`/`getProposalCartLines`/`resolveBasketByToken`). Never recomputed: this
 * is what makes S22's byte-identical guarantee true by construction.
 */
export type AssistedSellingProposalCartPricedLine = {
  id: string
  productId: string
  variantId: string | null
  sku: string | null
  name: string
  quantity: string
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  priceKindId: string | null
  priceRowId: string | null
  lineTotals: Record<string, unknown>
}

export type AssistedSellingProposalCartPricedDetail = {
  currencyCode: string
  status: string
  expiresAt: Date
  lines: AssistedSellingProposalCartPricedLine[]
} | null

/**
 * Step 4.5 (§5.1/§6.2, D-R5-21). The buyer thread routes' own "resolve the `X-Cart-Token`
 * header to its basket cart through `cart`'s DI service" — the same `cartService` surface
 * this file already duck-types, one more method. `status` is a plain string here (never
 * `cart`'s own `Cart['status']` literal union type), consistent with `AssistedSellingCartSummary`
 * above — this file intentionally carries no type import from `cart/data/entities.ts` either.
 */
export type AssistedSellingResolvedBasket = {
  id: string
  tenantId: string
  organizationId: string
  storeId: string | null
  status: string
  customerId: string | null
  customerUserId: string | null
}

/**
 * Step 5.4 (§5.5/§6.7, S18). The `cart.cart.converted` attribution subscriber's own read —
 * a converted basket's live lines with their actor provenance, snapshot amounts, and (when a
 * line arrived via an accepted proposal) the `proposal_cart_id` it came from.
 */
export type AssistedSellingAttributionLine = {
  id: string
  addedByActorType: string
  addedByActorId: string | null
  netAmount: string
  grossAmount: string
  proposalCartId: string | null
  proposalContributions?: Array<{ proposalCartId: string; quantity: string }>
  quantity?: string
}

export type AssistedSellingAttributionCartDetail = {
  currencyCode: string
  lines: AssistedSellingAttributionLine[]
} | null

export type AssistedSellingCartServiceLike = {
  getForOrganizations(input: {
    tenantId: string
    organizationIds: string[] | null
    cartId: string
  }): Promise<AssistedSellingCartSummary | null>
  getProposalCartLines(input: {
    tenantId: string
    organizationId: string
    proposalCartId: string
  }): Promise<AssistedSellingProposalCartLine[]>
  /** Step 4.5. Scope-free `kind: 'basket'` resolution by token — `null` for an unknown
   * token, collapsing with every other "no match" outcome (no enumeration oracle). */
  resolveBasketByToken(input: { token: string }): Promise<AssistedSellingResolvedBasket | null>
  /** Step 5.3 (§7.1/§7.2, S22). A `kind: 'proposal'` cart's own priced lines, for the
   * thread detail read and the console's proposal cards. */
  getProposalCartPricedLines(input: {
    tenantId: string
    organizationId: string
    proposalCartId: string
  }): Promise<AssistedSellingProposalCartPricedDetail>
  /** Step 5.4 (§5.5/§6.7, S18). A `kind: 'basket'` cart's own live lines, for the attribution
   * subscriber — `null` when the basket no longer exists. */
  getAttributionLines(input: {
    tenantId: string
    organizationId: string
    cartId: string
  }): Promise<AssistedSellingAttributionCartDetail>
}

export function resolveCartService(container: {
  resolve: <T = unknown>(name: string) => T
}): AssistedSellingCartServiceLike {
  return container.resolve<AssistedSellingCartServiceLike>('cartService')
}
