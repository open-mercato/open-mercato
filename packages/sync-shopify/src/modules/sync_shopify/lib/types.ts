export const SHOPIFY_INTEGRATION_ID = 'sync_shopify'
export const SHOPIFY_PROVIDER_KEY = 'shopify'
export const DEFAULT_SHOPIFY_API_VERSION = '2026-07'
export const SHOPIFY_API_VERSIONS = ['2026-10', '2026-07', '2026-04', '2026-01'] as const

export const SHOPIFY_ENTITY_TYPES = ['products', 'customers', 'orders'] as const
export type ShopifyEntityType = (typeof SHOPIFY_ENTITY_TYPES)[number]

export type ShopifySelectedOption = {
  name: string
  value: string
}

export type ShopifyVariantNode = {
  id: string
  sku: string | null
  barcode: string | null
  title: string
  price: string
  compareAtPrice: string | null
  selectedOptions: ShopifySelectedOption[]
}

export type ShopifyProductNode = {
  id: string
  title: string
  descriptionHtml: string | null
  handle: string
  status: string
  vendor: string | null
  productType: string | null
  tags: string[]
  variants: ShopifyVariantNode[]
}

export type ShopifyCustomerNode = {
  id: string
  firstName: string | null
  lastName: string | null
  displayName: string | null
  email: string | null
  phone: string | null
}

export type ShopifyMoney = {
  amount: string
  currencyCode: string
}

export type ShopifyOrderLineNode = {
  id: string
  title: string
  sku: string | null
  quantity: number
  variantId: string | null
  unitPrice: ShopifyMoney | null
}

export type ShopifyOrderNode = {
  id: string
  name: string
  email: string | null
  createdAt: string
  currencyCode: string
  displayFinancialStatus: string | null
  displayFulfillmentStatus: string | null
  customerId: string | null
  total: ShopifyMoney | null
  lines: ShopifyOrderLineNode[]
}

export type ShopifyPage<T> = {
  nodes: T[]
  endCursor: string | null
  hasNextPage: boolean
}

export type ShopifyShop = {
  name: string
  currencyCode: string
}
