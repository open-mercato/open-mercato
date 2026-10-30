/**
 * Quantity-rule derivation — shared by any caller that already holds a resolved
 * `AvailabilityPolicy` field set (e.g. `policyResolutionService`'s `minOrderQuantity` /
 * `maxOrderQuantity` / `quantityIncrement`) and a catalog product's own order-quantity
 * columns, and needs the one final "buy in multiples of N" / "minimum N per order" /
 * "maximum N per order" rule set a buyer-facing surface renders.
 *
 * Extracted (additive, no behavior change) from `ecommerce`'s
 * `getStorefrontProductDetail` so other modules (e.g. a future `cart` module) can derive
 * the same rules without depending on `ecommerce`. `ecommerce` itself is repointed onto
 * this helper in a separate, later change.
 */

type ResolvedQuantityRuleField<T> = { value: T } | null | undefined

/** Matches `StorefrontResolvedPolicy`'s per-field shape — a resolved policy may omit any field. */
export type QuantityRulePolicy = {
  minOrderQuantity?: ResolvedQuantityRuleField<number | null>
  maxOrderQuantity?: ResolvedQuantityRuleField<number | null>
  quantityIncrement?: ResolvedQuantityRuleField<number | null>
} | null | undefined

/** The catalog product's own order-quantity columns, read when the policy sets none. */
export type QuantityRuleProductFallback = {
  minOrderQty?: unknown
  maxOrderQty?: unknown
  orderQtyIncrement?: unknown
}

export type QuantityRules = {
  minOrderQuantity: number | null
  maxOrderQuantity: number | null
  quantityIncrement: number | null
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * The resolved policy's own value wins per field; a field the policy leaves unset (no
 * entry, or `{ value: null }`) falls back to the product's own order-quantity column.
 */
export function deriveQuantityRules(
  policy: QuantityRulePolicy,
  product: QuantityRuleProductFallback,
): QuantityRules {
  return {
    minOrderQuantity: policy?.minOrderQuantity?.value ?? toNumber(product.minOrderQty),
    maxOrderQuantity: policy?.maxOrderQuantity?.value ?? toNumber(product.maxOrderQty),
    quantityIncrement: policy?.quantityIncrement?.value ?? toNumber(product.orderQtyIncrement),
  }
}
