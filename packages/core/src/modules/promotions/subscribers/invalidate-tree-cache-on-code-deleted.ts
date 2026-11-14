import { handlePromotionTreeCacheInvalidation } from '../services/promotion-cache'

export const metadata = {
  event: 'promotions.code.deleted',
  persistent: false,
  id: 'promotions:invalidate-tree-cache-on-code-deleted',
}

export default handlePromotionTreeCacheInvalidation
