import { handlePromotionUsageCounterCacheInvalidation } from '../services/promotion-cache'

export const metadata = {
  event: 'promotions.usage.reverted',
  persistent: false,
  id: 'promotions:invalidate-usage-counter-cache-on-reverted',
}

export default handlePromotionUsageCounterCacheInvalidation
