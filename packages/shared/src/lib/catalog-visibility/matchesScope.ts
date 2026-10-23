import type { EffectiveAssortmentScope, ScopedProduct } from './types'
import { matchesOne } from './matchesOne'

/** OR across sources. `null` -> true (unrestricted). `[]` -> false for every product (deny-all). */
export function matchesScope(product: ScopedProduct, effective: EffectiveAssortmentScope): boolean {
  if (effective === null) return true
  return effective.some((scope) => matchesOne(product, scope))
}
