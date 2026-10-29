import {
  reindexProductsForCategorySubtree,
  type CategoryScopeChangePayload,
  type ProductScopeReindexContext,
} from '../lib/productScopeReindex'

export const metadata = {
  event: 'catalog.category.deleted',
  persistent: true,
  id: 'catalog:product-scope-keys-category-deleted',
}

export default async function handle(
  payload: CategoryScopeChangePayload,
  ctx: ProductScopeReindexContext,
): Promise<void> {
  await reindexProductsForCategorySubtree(payload, ctx)
}
