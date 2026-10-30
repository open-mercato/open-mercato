import {
  reindexProductsForCategorySubtree,
  type CategoryScopeChangePayload,
  type ProductScopeReindexContext,
} from '../lib/productScopeReindex'

export const metadata = {
  event: 'catalog.category.updated',
  persistent: true,
  id: 'catalog:product-scope-keys-category-updated',
}

export default async function handle(
  payload: CategoryScopeChangePayload,
  ctx: ProductScopeReindexContext,
): Promise<void> {
  if (payload?.hierarchyChanged !== true) return
  await reindexProductsForCategorySubtree(payload, ctx)
}
