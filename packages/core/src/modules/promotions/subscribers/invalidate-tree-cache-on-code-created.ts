import { handlePromotionTreeCacheInvalidation } from '../services/promotion-cache'

export const metadata = {
  event: 'promotions.code.created',
  persistent: false,
  id: 'promotions:invalidate-tree-cache-on-code-created',
}

export default handlePromotionTreeCacheInvalidation
