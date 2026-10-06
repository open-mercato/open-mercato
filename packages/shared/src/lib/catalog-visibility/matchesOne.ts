import type { AssortmentScope, ScopedProduct } from './types'

function overlaps(productIds: string[], scopeIds: string[]): boolean {
  if (productIds.length === 0 || scopeIds.length === 0) return false
  const set = new Set(scopeIds)
  return productIds.some((id) => set.has(id))
}

function included(product: ScopedProduct, scope: AssortmentScope): boolean {
  const categoryIds = scope.categoryIds ?? []
  const tagIds = scope.tagIds ?? []
  const categoryOk = categoryIds.length === 0 || overlaps(product.categoryIds, categoryIds)
  const tagOk = tagIds.length === 0 || overlaps(product.tagIds, tagIds)
  return categoryOk && tagOk
}

/** AND match of one scope, including every nested `allOf` scope. */
export function matchesOne(product: ScopedProduct, scope: AssortmentScope): boolean {
  if (!included(product, scope)) return false
  const excludeProductIds = scope.excludeProductIds ?? []
  if (excludeProductIds.includes(product.id)) return false
  const excludeCategoryIds = scope.excludeCategoryIds ?? []
  if (excludeCategoryIds.length > 0 && overlaps(product.categoryIds, excludeCategoryIds)) return false
  const excludeTagIds = scope.excludeTagIds ?? []
  if (excludeTagIds.length > 0 && overlaps(product.tagIds, excludeTagIds)) return false
  const allOf = scope.allOf ?? []
  return allOf.every((nested) => matchesOne(product, nested))
}
