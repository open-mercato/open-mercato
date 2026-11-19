import { readShopifyEnvPreset } from '../lib/preset'

describe('readShopifyEnvPreset', () => {
  it('returns null until both required variables are set', () => {
    expect(readShopifyEnvPreset({})).toBeNull()
    expect(readShopifyEnvPreset({
      OM_INTEGRATION_SHOPIFY_SHOP_DOMAIN: 'demo.myshopify.com',
      OM_INTEGRATION_SHOPIFY_CLIENT_ID: 'client-id',
      OM_INTEGRATION_SHOPIFY_CLIENT_SECRET: 'client-secret',
    })).toMatchObject({
      shopDomain: 'demo.myshopify.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      apiVersion: '2026-07',
      force: false,
    })
  })
})
