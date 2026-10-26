import { handlePromotionTreeCacheInvalidation } from '../services/promotion-cache'

export const metadata = {
  event: 'promotions.promotion.deleted',
  persistent: false,
  id: 'promotions:invalidate-tree-cache-on-promotion-deleted',
}

export default handlePromotionTreeCacheInvalidation
