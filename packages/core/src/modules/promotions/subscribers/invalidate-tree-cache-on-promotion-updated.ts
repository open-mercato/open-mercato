import { handlePromotionTreeCacheInvalidation } from '../services/promotion-cache'

export const metadata = {
  event: 'promotions.promotion.updated',
  persistent: false,
  id: 'promotions:invalidate-tree-cache-on-promotion-updated',
}

export default handlePromotionTreeCacheInvalidation
