import { clearShopifyAccessTokenCache, createShopifyClient, normalizeShopDomain, ShopifyClientError } from '../lib/client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('normalizeShopDomain', () => {
  it('accepts a myshopify host and strips a scheme', () => {
    expect(normalizeShopDomain('https://Demo-Store.myshopify.com/admin')).toBe('demo-store.myshopify.com')
  })

  it('rejects a custom domain', () => {
    expect(() => normalizeShopDomain('shop.example.com')).toThrow(ShopifyClientError)
  })
})

describe('createShopifyClient', () => {
  beforeEach(() => {
    clearShopifyAccessTokenCache()
  })

  const credentials = {
    shopDomain: 'demo-store.myshopify.com',
    accessToken: 'shpat_test',
    apiVersion: '2026-07',
  }

  it('sends the admin token and reads a product page', async () => {
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'X-Shopify-Access-Token': 'shpat_test' })
      const body = JSON.parse(String(init?.body))
      expect(body.variables).toEqual({ first: 25, after: null })
      return jsonResponse({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{
              id: 'gid://shopify/Product/1',
              title: 'Beans',
              descriptionHtml: '<p>Dark</p>',
              handle: 'beans',
              status: 'ACTIVE',
              vendor: 'Kaldi',
              productType: 'Coffee',
              tags: ['retail'],
              variants: { nodes: [{ id: 'gid://shopify/ProductVariant/9', sku: 'BEAN', barcode: null, title: '250g', price: '12.00', compareAtPrice: null, selectedOptions: [] }] },
            }],
          },
        },
      })
    })

    const page = await createShopifyClient(credentials, { fetchImpl: fetchImpl as unknown as typeof fetch }).listProducts(null, 100)
    expect(page.hasNextPage).toBe(false)
    expect(page.nodes[0]?.variants[0]?.sku).toBe('BEAN')
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://demo-store.myshopify.com/admin/api/2026-07/graphql.json')
  })

  it('surfaces GraphQL errors and a page without a cursor', async () => {
    const errorFetch = jest.fn(async () => jsonResponse({ errors: [{ message: 'Throttled' }] }))
    await expect(createShopifyClient(credentials, { fetchImpl: errorFetch as unknown as typeof fetch }).shop())
      .rejects.toThrow('Throttled')

    const cursorFetch = jest.fn(async () => jsonResponse({
      data: { orders: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [] } },
    }))
    await expect(createShopifyClient(credentials, { fetchImpl: cursorFetch as unknown as typeof fetch }).listOrders(null, 10))
      .rejects.toThrow('without a cursor')
  })

  it('exchanges client credentials once and reuses the token', async () => {
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/admin/oauth/access_token')) {
        const params = new URLSearchParams(String(init?.body))
        expect(params.get('grant_type')).toBe('client_credentials')
        expect(params.get('client_id')).toBe('client-id')
        expect(params.get('client_secret')).toBe('client-secret')
        return jsonResponse({ access_token: 'exchanged-token', expires_in: 86_399, scope: 'read_products' })
      }
      expect(init?.headers).toMatchObject({ 'X-Shopify-Access-Token': 'exchanged-token' })
      return jsonResponse({ data: { shop: { name: 'Demo', currencyCode: 'USD' } } })
    })
    const client = createShopifyClient({
      shopDomain: 'demo-store.myshopify.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    }, { fetchImpl: fetchImpl as unknown as typeof fetch })

    await client.shop()
    await client.shop()

    const tokenCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).endsWith('/admin/oauth/access_token'))
    expect(tokenCalls).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('omits the client secret from a refused token exchange', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({
      error: 'shop_not_permitted',
      error_description: 'Client credentials cannot be performed on this shop.',
    }, 400))
    await expect(createShopifyClient({
      shopDomain: 'demo-store.myshopify.com',
      clientId: 'client-id',
      clientSecret: 'super-secret-value',
    }, { fetchImpl: fetchImpl as unknown as typeof fetch }).shop()).rejects.toThrow(
      'Shopify refused the client credentials (HTTP 400). shop_not_permitted: Client credentials cannot be performed on this shop.',
    )
  })
})
