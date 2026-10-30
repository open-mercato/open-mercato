import { handlePromotionTreeCacheInvalidation } from '../services/promotion-cache'

export const metadata = {
  event: 'promotions.code.updated',
  persistent: false,
  id: 'promotions:invalidate-tree-cache-on-code-updated',
}

export default handlePromotionTreeCacheInvalidation
