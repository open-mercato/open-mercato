import { handlePromotionUsageCounterCacheInvalidation } from '../services/promotion-cache'

export const metadata = {
  event: 'promotions.usage.registered',
  persistent: false,
  id: 'promotions:invalidate-usage-counter-cache-on-registered',
}

export default handlePromotionUsageCounterCacheInvalidation
