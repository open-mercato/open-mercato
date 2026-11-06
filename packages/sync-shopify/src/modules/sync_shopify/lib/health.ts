import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createShopifyClient } from './client'

export const shopifyHealthCheck = {
  async check(credentials: Record<string, unknown>) {
    const { translate } = await resolveTranslations()
    try {
      const shop = await createShopifyClient(credentials).shop()
      return {
        status: 'healthy' as const,
        message: translate('sync_shopify.health.connected', 'Connected to {shopName}', {
          shopName: shop.name,
        }),
        details: { currencyCode: shop.currencyCode },
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : translate('sync_shopify.health.unknownError', 'Unknown Shopify error')
      return {
        status: 'unhealthy' as const,
        message: translate('sync_shopify.health.failed', 'Shopify connection failed: {message}', {
          message,
        }),
        details: { error: message },
      }
    }
  },
}
