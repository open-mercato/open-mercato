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
const TAX_INCLUSIVE_ORDER_ID = 'gid://shopify/Order/9003'
const TAXED_SHIPPING_ORDER_ID = 'gid://shopify/Order/9004'

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
      taxLines: [],
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

/** EU-style: 123.00 incl. 23.00 VAT at 23% (#7395). */
const taxInclusiveOrder = {
  id: TAX_INCLUSIVE_ORDER_ID,
  name: '#QA9003',
  email: 'ada.qa.sync-shopify@example.com',
  createdAt: '2026-10-03T12:00:00.000Z',
  currencyCode: 'EUR',
  taxesIncluded: true,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  customer: { id: CUSTOMER_ID },
  totalPriceSet: money('123.00', 'EUR'),
  subtotalPriceSet: money('123.00', 'EUR'),
  totalDiscountsSet: money('0.00', 'EUR'),
  totalShippingPriceSet: money('0.00', 'EUR'),
  totalTaxSet: money('23.00', 'EUR'),
  shippingLines: { nodes: [] as unknown[] },
}

const taxInclusiveLineItems = [{
  id: 'gid://shopify/LineItem/9400',
  title: 'Coffee beans 1 kg',
  sku: 'QA-SKU-1',
  quantity: 1,
  variant: { id: variants[0]!.id },
  originalUnitPriceSet: money('123.00', 'EUR'),
  discountedUnitPriceSet: money('123.00', 'EUR'),
  originalTotalSet: money('123.00', 'EUR'),
  discountedTotalSet: money('123.00', 'EUR'),
  discountAllocations: [],
  taxLines: [{
    rate: 0.23,
    ratePercentage: 23,
    priceSet: money('23.00', 'EUR'),
  }],
}]

/** US-style: item 100+8 tax, shipping 10+0.80 tax → 118.80 / 8.80 (#7396). */
const taxedShippingOrder = {
  id: TAXED_SHIPPING_ORDER_ID,
  name: '#QA9004',
  email: 'ada.qa.sync-shopify@example.com',
  createdAt: '2026-10-04T12:00:00.000Z',
  currencyCode: 'USD',
  taxesIncluded: false,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  customer: { id: CUSTOMER_ID },
  totalPriceSet: money('118.80'),
  subtotalPriceSet: money('100.00'),
  totalDiscountsSet: money('0.00'),
  totalShippingPriceSet: money('10.00'),
  totalTaxSet: money('8.80'),
  shippingLines: {
    nodes: [{
      id: 'gid://shopify/ShippingLine/2',
      title: 'Standard',
      originalPriceSet: money('10.00'),
      discountedPriceSet: money('10.00'),
      taxLines: [{
        rate: 0.08,
        ratePercentage: 8,
        priceSet: money('0.80'),
      }],
    }],
  },
}

const taxedShippingLineItems = [{
  id: 'gid://shopify/LineItem/9500',
  title: 'Coffee beans 1 kg',
  sku: 'QA-SKU-1',
  quantity: 1,
  variant: { id: variants[0]!.id },
  originalUnitPriceSet: money('100.00'),
  discountedUnitPriceSet: money('100.00'),
  originalTotalSet: money('100.00'),
  discountedTotalSet: money('100.00'),
  discountAllocations: [],
  taxLines: [{
    rate: 0.08,
    ratePercentage: 8,
    priceSet: money('8.00'),
  }],
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
          {
            ...taxInclusiveOrder,
            lineItems: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: taxInclusiveLineItems,
            },
          },
          {
            ...taxedShippingOrder,
            lineItems: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: taxedShippingLineItems,
            },
          },
        ],
      },
    }
  }

  if (name === 'ShopifyOrderLineItems') {
    const orderId = typeof variables.id === 'string' ? variables.id : ORDER_ID
    const source: unknown[] = orderId === ORDER_ID
      ? lineItems
      : orderId === DISCOUNTED_ORDER_ID
        ? discountedLineItems
        : orderId === TAX_INCLUSIVE_ORDER_ID
          ? taxInclusiveLineItems
          : orderId === TAXED_SHIPPING_ORDER_ID
            ? taxedShippingLineItems
            : lineItems
    return {
      order: {
        lineItems: pageSlice(source, first, after),
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
