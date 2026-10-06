import { createShopifyClient } from './client'

export const shopifyHealthCheck = {
  async check(credentials: Record<string, unknown>) {
    try {
      const shop = await createShopifyClient(credentials).shop()
      return {
        status: 'healthy' as const,
        message: `Connected to ${shop.name}`,
        details: { currencyCode: shop.currencyCode },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Shopify error'
      return {
        status: 'unhealthy' as const,
        message: `Shopify connection failed: ${message}`,
        details: { error: message },
      }
    }
  },
}
