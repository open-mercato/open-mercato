import { handlePromotionTreeCacheInvalidation } from '../services/promotion-cache'

export const metadata = {
  event: 'promotions.promotion.created',
  persistent: false,
  id: 'promotions:invalidate-tree-cache-on-promotion-created',
}

export default handlePromotionTreeCacheInvalidation
