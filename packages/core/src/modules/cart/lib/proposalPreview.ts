import type { EntityManager } from '@mikro-orm/postgresql'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { filterRowsForVariant } from '@open-mercato/core/modules/catalog/lib/pricing'

import { Cart, CartLine } from '../data/entities'
import {
  buildCartPricingRowFilterContext,
  fetchPriceRowsBatch,
  groupRowsByProduct,
  resolveLinePricing,
} from '../commands/lines'
import { cartVisibilityKey, evaluateCartVisibility, isVisible } from './visibility'

// Step 3.4 (§7a.4) — `POST /proposals/:id/preview`'s dry-run. "Creates nothing" (TC-CART-PROP-10):
// no `em.persist`/`em.flush`/`withAtomicFlush` call anywhere in this file — every helper this
// reuses from `commands/lines.ts` (`fetchPriceRowsBatch`, `resolveLinePricing`, ...) is itself a
// pure read against the SAME forked `em` the route already holds, matching this Step's own brief
// ("re-price the proposal's line snapshot against the requester's resolved identity, WITHOUT
// creating or mutating anything"). Priced against the TARGET cart's CURRENT buyer context
// (`buildCartPricingRowFilterContext(target)`), never the proposal's own stale snapshot and
// never the author's — the same R14 guarantee `cart.proposal.create` enforces at authoring time,
// re-asserted here at acceptance time per §7a.2's "re-check every line against the freshly
// resolved scope of the buyer's own request" (TC-CART-PROP-04).

export type ProposalAcceptancePreviewLine = {
  proposalLineId: string
  productId: string
  variantId: string | null
  quantity: string
  /** The price the author/buyer saw when the proposal was authored (or last re-priced) —
   * `CartLine.unitPriceNet`/`unitPriceGross` as stored on the proposal's own row. */
  proposedUnitPriceNet: string | null
  proposedUnitPriceGross: string | null
  /** Re-resolved NOW against the target buyer's current context — `null` when the line is
   * `rejected`. */
  currentUnitPriceNet: string | null
  currentUnitPriceGross: string | null
  rejected: boolean
  reason?: 'product_unavailable'
}

export type ProposalAcceptancePreview = {
  proposalCartId: string
  targetCartId: string
  lines: ProposalAcceptancePreviewLine[]
}

export type BuildProposalAcceptancePreviewParams = {
  em: EntityManager
  container: { resolve: <T = unknown>(name: string) => T }
  scope: { tenantId: string; organizationId: string }
  target: Cart
  proposal: Cart
  assortmentScope: EffectiveAssortmentScope | undefined
}

export async function buildProposalAcceptancePreview(
  params: BuildProposalAcceptancePreviewParams,
): Promise<ProposalAcceptancePreview> {
  const { em, container, scope, target, proposal, assortmentScope } = params

  const proposalLines = (await findWithDecryption(
    em,
    CartLine,
    { cartId: proposal.id, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )) as CartLine[]

  if (proposalLines.length === 0) {
    return { proposalCartId: proposal.id, targetCartId: target.id, lines: [] }
  }

  const visibility = await evaluateCartVisibility({
    lines: proposalLines.map((line) => ({ productId: line.productId, variantId: line.variantId ?? null })),
    scope: assortmentScope,
    tenantScope: scope,
    em,
    container,
  })

  const productIds = Array.from(new Set(proposalLines.map((line) => line.productId)))
  const variantIds = Array.from(
    new Set(proposalLines.map((line) => line.variantId).filter((id): id is string => !!id)),
  )
  const variantToProduct = new Map<string, string>()
  for (const line of proposalLines) {
    if (line.variantId) variantToProduct.set(line.variantId, line.productId)
  }

  const pricingContext = buildCartPricingRowFilterContext(target)
  const priceRows = await fetchPriceRowsBatch(em, scope, pricingContext, productIds, variantIds)
  const rowsByProduct = groupRowsByProduct(priceRows, variantToProduct)
  const now = new Date()

  const lines: ProposalAcceptancePreviewLine[] = []
  for (const line of proposalLines) {
    const visibilityRef = { productId: line.productId, variantId: line.variantId ?? null }
    const visible = isVisible(visibility.get(cartVisibilityKey(visibilityRef)) ?? 'unavailable')
    const base = {
      proposalLineId: line.id,
      productId: line.productId,
      variantId: line.variantId ?? null,
      quantity: line.quantity,
      proposedUnitPriceNet: line.unitPriceNet ?? null,
      proposedUnitPriceGross: line.unitPriceGross ?? null,
    }
    if (!visible) {
      lines.push({ ...base, currentUnitPriceNet: null, currentUnitPriceGross: null, rejected: true, reason: 'product_unavailable' })
      continue
    }
    // Called unconditionally, even when the batched price-row fetch returned nothing for
    // this product — same precedent `cart.proposal.create`'s own line loop sets
    // (`commands/proposal.ts`): `resolveLinePricing`'s underlying `catalogBuyerPricingService`
    // call is the one place that gets to say "unpriceable," not an empty-rows short-circuit
    // here.
    const rows = filterRowsForVariant(rowsByProduct.get(line.productId) ?? [], line.variantId ?? null)
    const resolved = await resolveLinePricing(em, container, target, rows, Number(line.quantity), now)
    if (!resolved.priceRow) {
      lines.push({ ...base, currentUnitPriceNet: null, currentUnitPriceGross: null, rejected: true, reason: 'product_unavailable' })
      continue
    }
    lines.push({
      ...base,
      currentUnitPriceNet: resolved.amountNet !== null ? String(resolved.amountNet) : null,
      currentUnitPriceGross: resolved.amountGross !== null ? String(resolved.amountGross) : null,
      rejected: false,
    })
  }

  return { proposalCartId: proposal.id, targetCartId: target.id, lines }
}
