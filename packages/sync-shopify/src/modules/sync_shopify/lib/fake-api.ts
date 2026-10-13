import { setShopifyDefaultFetch } from './client'
import { DEFAULT_SHOPIFY_API_VERSION } from './types'

export const OM_SYNC_SHOPIFY_FAKE_API = 'OM_SYNC_SHOPIFY_FAKE_API'
export const FAKE_SHOPIFY_SHOP_DOMAIN = 'qa-import.myshopify.com'
export const FAKE_SHOPIFY_CLIENT_ID = 'qa-sync-shopify-client'
export const FAKE_SHOPIFY_CLIENT_SECRET = 'qa-sync-shopify-secret'

type Money = { shopMoney: { amount: string; currencyCode: string } }

function money(amount: string, currencyCode = 'USD'): Money {
  return { shopMoney: { amount, currencyCode } }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function pageSlice<T>(items: T[], first: number, after: string | null): {
  nodes: T[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
} {
  const start = after ? Number(after) : 0
  const safeStart = Number.isFinite(start) && start >= 0 ? start : 0
  const nodes = items.slice(safeStart, safeStart + first)
  const next = safeStart + nodes.length
  const hasNextPage = next < items.length
  return {
    nodes,
    pageInfo: {
      hasNextPage,
      endCursor: hasNextPage ? String(next) : null,
    },
  }
}

const PRODUCT_ID = 'gid://shopify/Product/9001'
const CUSTOMER_ID = 'gid://shopify/Customer/9001'
const ORDER_ID = 'gid://shopify/Order/9001'
const DISCOUNTED_ORDER_ID = 'gid://shopify/Order/9002'

const variants = Array.from({ length: 105 }, (_, index) => ({
  id: `gid://shopify/ProductVariant/${9100 + index}`,
  sku: `QA-SKU-${index + 1}`,
  barcode: null,
  title: `Variant ${index + 1}`,
  price: '12.00',
  compareAtPrice: null,
  selectedOptions: [{ name: 'Size', value: `S${index + 1}` }],
}))

const lineItems = Array.from({ length: 55 }, (_, index) => ({
  id: `gid://shopify/LineItem/${9200 + index}`,
  title: `Line ${index + 1}`,
  sku: `QA-SKU-${index + 1}`,
  quantity: 1,
  variant: { id: variants[index % variants.length]!.id },
  originalUnitPriceSet: money('10.00'),
  discountedUnitPriceSet: money('10.00'),
  originalTotalSet: money('10.00'),
  discountedTotalSet: money('10.00'),
  discountAllocations: [],
  taxLines: [],
}))

const productNode = {
  id: PRODUCT_ID,
  title: 'QA Shopify Import Product',
  descriptionHtml: '<p>Imported by TC-SS-001</p>',
  handle: 'qa-shopify-import-product',
  status: 'ACTIVE',
  vendor: 'Open Mercato QA',
  productType: 'Coffee',
  tags: ['qa', 'sync_shopify'],
}

const customerNode = {
  id: CUSTOMER_ID,
  firstName: 'Ada',
  lastName: 'Lovelace',
  displayName: 'Ada Lovelace',
  email: 'ada.qa.sync-shopify@example.com',
  phone: null,
}

const simpleOrder = {
  id: ORDER_ID,
  name: '#QA9001',
  email: 'ada.qa.sync-shopify@example.com',
  createdAt: '2026-10-01T12:00:00.000Z',
  currencyCode: 'USD',
  taxesIncluded: true,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  customer: { id: CUSTOMER_ID },
  totalPriceSet: money('550.00'),
  subtotalPriceSet: money('550.00'),
  totalDiscountsSet: money('0.00'),
  totalShippingPriceSet: money('0.00'),
  totalTaxSet: money('0.00'),
  shippingLines: { nodes: [] as unknown[] },
}

const discountedOrder = {
  id: DISCOUNTED_ORDER_ID,
  name: '#QA9002',
  email: 'ada.qa.sync-shopify@example.com',
  createdAt: '2026-10-02T12:00:00.000Z',
  currencyCode: 'USD',
  taxesIncluded: false,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  customer: { id: CUSTOMER_ID },
  totalPriceSet: money('88.00'),
  subtotalPriceSet: money('80.00'),
  totalDiscountsSet: money('20.00'),
  totalShippingPriceSet: money('8.00'),
  totalTaxSet: money('0.00'),
  shippingLines: {
    nodes: [{
      id: 'gid://shopify/ShippingLine/1',
      title: 'Standard',
      originalPriceSet: money('8.00'),
      discountedPriceSet: money('8.00'),
    }],
  },
}

const discountedLineItems = [{
  id: 'gid://shopify/LineItem/9300',
  title: 'Discounted Beans',
  sku: 'QA-SKU-1',
  quantity: 1,
  variant: { id: variants[0]!.id },
  originalUnitPriceSet: money('100.00'),
  discountedUnitPriceSet: money('80.00'),
  originalTotalSet: money('100.00'),
  discountedTotalSet: money('80.00'),
  discountAllocations: [{ allocatedAmountSet: money('20.00') }],
  taxLines: [],
}]

function operationName(query: string): string {
  const match = query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/)
  return match?.[1] ?? ''
}

function handleGraphql(query: string, variables: Record<string, unknown>): unknown {
  const name = operationName(query)
  const first = typeof variables.first === 'number' ? variables.first : 25
  const after = typeof variables.after === 'string' ? variables.after : null
  const nestedFirst = typeof variables.variantFirst === 'number'
    ? variables.variantFirst
    : typeof variables.lineFirst === 'number'
      ? variables.lineFirst
      : first

  if (name === 'ShopifyShop') {
    return { shop: { name: 'QA Shopify Import', currencyCode: 'USD' } }
  }

  if (name === 'ShopifyProducts') {
    const variantPage = pageSlice(variants, nestedFirst, null)
    return {
      products: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{
          ...productNode,
          variants: variantPage,
        }],
      },
    }
  }

  if (name === 'ShopifyProductVariants') {
    return {
      product: {
        variants: pageSlice(variants, first, after),
      },
    }
  }

  if (name === 'ShopifyCustomers') {
    return {
      customers: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [customerNode],
      },
    }
  }

  if (name === 'ShopifyOrders') {
    const firstOrderLines = pageSlice(lineItems, nestedFirst, null)
    return {
      orders: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            ...simpleOrder,
            lineItems: firstOrderLines,
          },
          {
            ...discountedOrder,
            lineItems: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: discountedLineItems,
            },
          },
        ],
      },
    }
  }

  if (name === 'ShopifyOrderLineItems') {
    return {
      order: {
        lineItems: pageSlice(lineItems, first, after),
      },
    }
  }

  return { errors: [{ message: `Unsupported fake Shopify operation: ${name || 'unknown'}` }] }
}

export function isFakeShopifyApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[OM_SYNC_SHOPIFY_FAKE_API]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function createFakeShopifyFetch(realFetch: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (!url.includes('.myshopify.com/')) {
      return realFetch(input, init)
    }

    if (url.endsWith('/admin/oauth/access_token')) {
      const params = new URLSearchParams(String(init?.body ?? ''))
      if (params.get('client_id') !== FAKE_SHOPIFY_CLIENT_ID || params.get('client_secret') !== FAKE_SHOPIFY_CLIENT_SECRET) {
        return jsonResponse({ error: 'invalid_client', error_description: 'Fake Shopify rejected credentials.' }, 400)
      }
      return jsonResponse({
        access_token: 'shpat_fake_qa_token',
        expires_in: 86_399,
        scope: 'read_products,read_customers,read_orders',
      })
    }

    if (!url.includes(`/admin/api/${DEFAULT_SHOPIFY_API_VERSION}/graphql.json`) && !url.includes('/admin/api/')) {
      return jsonResponse({ errors: [{ message: 'Fake Shopify endpoint not found.' }] }, 404)
    }

    const payload = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: Record<string, unknown> }
    const data = handleGraphql(payload.query ?? '', payload.variables ?? {})
    if (data && typeof data === 'object' && 'errors' in data) {
      return jsonResponse(data)
    }
    return jsonResponse({ data })
  }) as typeof fetch
}

let installed = false

export function ensureFakeShopifyApiInstalled(): void {
  if (installed || !isFakeShopifyApiEnabled()) return
  setShopifyDefaultFetch(createFakeShopifyFetch())
  installed = true
}
