import {
  DEFAULT_SHOPIFY_API_VERSION,
  SHOPIFY_API_VERSIONS,
  type ShopifyCustomerNode,
  type ShopifyMoney,
  type ShopifyOrderLineNode,
  type ShopifyOrderNode,
  type ShopifyPage,
  type ShopifyProductNode,
  type ShopifyShippingLineNode,
  type ShopifyShop,
  type ShopifyVariantNode,
} from './types'

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/
const MAX_BATCH_SIZE = 25
export const SHOPIFY_NESTED_PAGE_SIZE = 50

export class ShopifyClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShopifyClientError'
  }
}

export type ShopifyClient = {
  shop(): Promise<ShopifyShop>
  listProducts(cursor: string | null, batchSize: number): Promise<ShopifyPage<ShopifyProductNode>>
  listCustomers(cursor: string | null, batchSize: number): Promise<ShopifyPage<ShopifyCustomerNode>>
  listOrders(cursor: string | null, batchSize: number): Promise<ShopifyPage<ShopifyOrderNode>>
}

export type ShopifyClientDeps = {
  fetchImpl?: typeof fetch
  nestedPageSize?: number
}

let defaultFetchImpl: typeof fetch | null = null

export function setShopifyDefaultFetch(fetchImpl: typeof fetch | null): void {
  defaultFetchImpl = fetchImpl
}

type GraphqlResponse<T> = {
  data?: T
  errors?: Array<{ message?: string }>
}

export function normalizeShopDomain(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ShopifyClientError('Shop domain is required.')
  }
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!SHOP_DOMAIN_PATTERN.test(host)) {
    throw new ShopifyClientError('Shop domain must look like your-store.myshopify.com.')
  }
  return host
}

export function resolveApiVersion(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return DEFAULT_SHOPIFY_API_VERSION
  const version = value.trim()
  if (!(SHOPIFY_API_VERSIONS as readonly string[]).includes(version)) {
    throw new ShopifyClientError(`Unsupported Shopify API version: ${version}`)
  }
  return version
}

const TOKEN_REFRESH_MARGIN_MS = 60_000

type CachedAccessToken = {
  token: string
  refreshAt: number
}

const accessTokenCache = new Map<string, CachedAccessToken>()
const accessTokenRequests = new Map<string, Promise<string>>()

export function clearShopifyAccessTokenCache(): void {
  accessTokenCache.clear()
  accessTokenRequests.clear()
}

function readTrimmed(credentials: Record<string, unknown>, key: string): string {
  const value = credentials[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readClientCredentials(credentials: Record<string, unknown>): { clientId: string; clientSecret: string } | null {
  const clientId = readTrimmed(credentials, 'clientId')
  const clientSecret = readTrimmed(credentials, 'clientSecret')
  if (!clientId && !clientSecret) return null
  if (!clientId || !clientSecret) {
    throw new ShopifyClientError('Client ID and client secret are both required.')
  }
  return { clientId, clientSecret }
}

type TokenPayload = {
  access_token?: unknown
  expires_in?: unknown
  error?: unknown
  error_description?: unknown
}

async function requestAccessToken(
  fetchImpl: typeof fetch,
  shopDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<{ token: string; expiresIn: number }> {
  const response = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const payload = await response.json().catch(() => null) as TokenPayload | null
  const token = typeof payload?.access_token === 'string' ? payload.access_token : ''
  if (!response.ok || token.length === 0) {
    const code = typeof payload?.error === 'string' ? payload.error : ''
    const description = typeof payload?.error_description === 'string' ? payload.error_description : ''
    const detail = [code, description].filter((part) => part.length > 0 && !part.includes(clientSecret)).join(': ')
    const suffix = detail.length > 0 ? ` ${detail}` : ''
    throw new ShopifyClientError(`Shopify refused the client credentials (HTTP ${response.status}).${suffix}`)
  }
  const expiresIn = typeof payload?.expires_in === 'number' && payload.expires_in > 0 ? payload.expires_in : 86_399
  return { token, expiresIn }
}

function clampBatchSize(batchSize: number): number {
  if (!Number.isFinite(batchSize) || batchSize < 1) return 1
  return Math.min(Math.floor(batchSize), MAX_BATCH_SIZE)
}

function clampNestedPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize < 1) return 1
  return Math.min(Math.floor(pageSize), SHOPIFY_NESTED_PAGE_SIZE)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asMoney(value: unknown): ShopifyMoney | null {
  const record = asRecord(value)
  const shopMoney = asRecord(record?.shopMoney)
  const amount = asString(shopMoney?.amount)
  const currencyCode = asString(shopMoney?.currencyCode)
  if (!amount || !currencyCode) return null
  return { amount, currencyCode }
}

function connectionNodes(value: unknown): unknown[] {
  const record = asRecord(value)
  return Array.isArray(record?.nodes) ? record.nodes : []
}

function readPageInfo(connection: unknown): { endCursor: string | null; hasNextPage: boolean } {
  const pageInfo = asRecord(asRecord(connection)?.pageInfo)
  return {
    endCursor: asString(pageInfo?.endCursor),
    hasNextPage: pageInfo?.hasNextPage === true,
  }
}

function mapVariant(value: unknown): ShopifyVariantNode | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  if (!record || !id) return null
  const selectedOptions = Array.isArray(record.selectedOptions)
    ? record.selectedOptions.flatMap((option) => {
        const row = asRecord(option)
        const name = asString(row?.name)
        const optionValue = asString(row?.value)
        return name && optionValue ? [{ name, value: optionValue }] : []
      })
    : []
  return {
    id,
    sku: asString(record.sku),
    barcode: asString(record.barcode),
    title: asString(record.title) ?? 'Default',
    price: asString(record.price) ?? '0',
    compareAtPrice: asString(record.compareAtPrice),
    selectedOptions,
  }
}

function mapProductShell(value: unknown): {
  product: Omit<ShopifyProductNode, 'variants'>
  variantsConnection: unknown
} | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  if (!record || !id) return null
  return {
    product: {
      id,
      title: asString(record.title) ?? 'Untitled product',
      descriptionHtml: asString(record.descriptionHtml),
      handle: asString(record.handle) ?? id,
      status: asString(record.status) ?? 'DRAFT',
      vendor: asString(record.vendor),
      productType: asString(record.productType),
      tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    },
    variantsConnection: record.variants,
  }
}

function mapCustomer(value: unknown): ShopifyCustomerNode | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  if (!record || !id) return null
  return {
    id,
    firstName: asString(record.firstName),
    lastName: asString(record.lastName),
    displayName: asString(record.displayName),
    email: asString(record.email),
    phone: asString(record.phone),
  }
}

function sumMoney(values: Array<ShopifyMoney | null>): ShopifyMoney | null {
  let total = 0
  let currencyCode: string | null = null
  for (const value of values) {
    if (!value) continue
    const amount = Number(value.amount)
    if (!Number.isFinite(amount)) continue
    total += amount
    currencyCode = currencyCode ?? value.currencyCode
  }
  if (!currencyCode) return null
  return { amount: total.toFixed(2), currencyCode }
}

/** Prefer ratePercentage (23); fall back to rate (0.23 → 23). */
function taxRatePercent(taxLines: unknown[]): number | null {
  let weightedAmount = 0
  let weightedRateSum = 0
  for (const raw of taxLines) {
    const taxLine = asRecord(raw)
    if (!taxLine) continue
    const money = asMoney(taxLine.priceSet)
    const amount = money ? Number(money.amount) : NaN
    const ratePercentage = typeof taxLine.ratePercentage === 'number'
      ? taxLine.ratePercentage
      : Number(taxLine.ratePercentage)
    const rate = typeof taxLine.rate === 'number' ? taxLine.rate : Number(taxLine.rate)
    let percent: number | null = null
    if (Number.isFinite(ratePercentage) && ratePercentage >= 0) {
      percent = ratePercentage
    } else if (Number.isFinite(rate) && rate >= 0) {
      percent = rate <= 1 ? rate * 100 : rate
    }
    if (percent === null) continue
    if (Number.isFinite(amount) && amount > 0) {
      weightedAmount += amount
      weightedRateSum += amount * percent
    } else if (weightedAmount === 0) {
      return percent
    }
  }
  if (weightedAmount > 0) return weightedRateSum / weightedAmount
  return null
}

function mapOrderLine(value: unknown): ShopifyOrderLineNode | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  if (!record || !id) return null
  const quantity = typeof record.quantity === 'number' ? record.quantity : Number(record.quantity)
  const discountAllocations = Array.isArray(record.discountAllocations)
    ? record.discountAllocations.map((allocation) => asMoney(asRecord(allocation)?.allocatedAmountSet))
    : []
  const rawTaxLines = Array.isArray(record.taxLines) ? record.taxLines : []
  const taxLines = rawTaxLines.map((taxLine) => asMoney(asRecord(taxLine)?.priceSet))
  return {
    id,
    title: asString(record.title) ?? 'Line',
    sku: asString(record.sku),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    variantId: asString(asRecord(record.variant)?.id),
    originalUnitPrice: asMoney(record.originalUnitPriceSet),
    discountedUnitPrice: asMoney(record.discountedUnitPriceSet),
    discountTotal: sumMoney(discountAllocations),
    taxTotal: sumMoney(taxLines),
    taxRate: taxRatePercent(rawTaxLines),
    totalPrice: asMoney(record.discountedTotalSet) ?? asMoney(record.originalTotalSet),
  }
}

function mapShippingLine(value: unknown): ShopifyShippingLineNode | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  if (!record || !id) return null
  const rawTaxLines = Array.isArray(record.taxLines) ? record.taxLines : []
  const taxLines = rawTaxLines.map((taxLine) => asMoney(asRecord(taxLine)?.priceSet))
  return {
    id,
    title: asString(record.title) ?? 'Shipping',
    originalPrice: asMoney(record.originalPriceSet),
    discountedPrice: asMoney(record.discountedPriceSet),
    taxTotal: sumMoney(taxLines),
    taxRate: taxRatePercent(rawTaxLines),
  }
}

function mapOrderShell(value: unknown): {
  order: Omit<ShopifyOrderNode, 'lines' | 'shippingLines'>
  lineItemsConnection: unknown
  shippingLines: ShopifyShippingLineNode[]
} | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  if (!record || !id) return null
  const shippingLines = connectionNodes(record.shippingLines).flatMap((node) => {
    const line = mapShippingLine(node)
    return line ? [line] : []
  })
  return {
    order: {
      id,
      name: asString(record.name) ?? id,
      email: asString(record.email),
      createdAt: asString(record.createdAt) ?? new Date(0).toISOString(),
      currencyCode: asString(record.currencyCode) ?? '',
      taxesIncluded: record.taxesIncluded === true,
      displayFinancialStatus: asString(record.displayFinancialStatus),
      displayFulfillmentStatus: asString(record.displayFulfillmentStatus),
      customerId: asString(asRecord(record.customer)?.id),
      total: asMoney(record.totalPriceSet),
      subtotal: asMoney(record.subtotalPriceSet),
      totalDiscounts: asMoney(record.totalDiscountsSet),
      totalShipping: asMoney(record.totalShippingPriceSet),
      totalTax: asMoney(record.totalTaxSet),
    },
    lineItemsConnection: record.lineItems,
    shippingLines,
  }
}

const VARIANT_FIELDS = `
  id
  sku
  barcode
  title
  price
  compareAtPrice
  selectedOptions { name value }
`

const LINE_ITEM_FIELDS = `
  id
  title
  sku
  quantity
  variant { id }
  originalUnitPriceSet { shopMoney { amount currencyCode } }
  discountedUnitPriceSet { shopMoney { amount currencyCode } }
  originalTotalSet { shopMoney { amount currencyCode } }
  discountedTotalSet { shopMoney { amount currencyCode } }
  discountAllocations {
    allocatedAmountSet { shopMoney { amount currencyCode } }
  }
  taxLines {
    rate
    ratePercentage
    priceSet { shopMoney { amount currencyCode } }
  }
`

const PRODUCTS_QUERY = `
  query ShopifyProducts($first: Int!, $after: String, $variantFirst: Int!) {
    products(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        descriptionHtml
        handle
        status
        vendor
        productType
        tags
        variants(first: $variantFirst) {
          pageInfo { hasNextPage endCursor }
          nodes { ${VARIANT_FIELDS} }
        }
      }
    }
  }
`

const PRODUCT_VARIANTS_QUERY = `
  query ShopifyProductVariants($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      variants(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${VARIANT_FIELDS} }
      }
    }
  }
`

const CUSTOMERS_QUERY = `
  query ShopifyCustomers($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { id firstName lastName displayName email phone }
    }
  }
`

const ORDERS_QUERY = `
  query ShopifyOrders($first: Int!, $after: String, $lineFirst: Int!) {
    orders(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        email
        createdAt
        currencyCode
        taxesIncluded
        displayFinancialStatus
        displayFulfillmentStatus
        customer { id }
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        shippingLines(first: 20) {
          nodes {
            id
            title
            originalPriceSet { shopMoney { amount currencyCode } }
            discountedPriceSet { shopMoney { amount currencyCode } }
            taxLines {
              rate
              ratePercentage
              priceSet { shopMoney { amount currencyCode } }
            }
          }
        }
        lineItems(first: $lineFirst) {
          pageInfo { hasNextPage endCursor }
          nodes { ${LINE_ITEM_FIELDS} }
        }
      }
    }
  }
`

const ORDER_LINE_ITEMS_QUERY = `
  query ShopifyOrderLineItems($id: ID!, $first: Int!, $after: String) {
    order(id: $id) {
      lineItems(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${LINE_ITEM_FIELDS} }
      }
    }
  }
`

const SHOP_QUERY = `
  query ShopifyShop {
    shop { name currencyCode }
  }
`

export function createShopifyClient(
  credentials: Record<string, unknown>,
  deps: ShopifyClientDeps = {},
): ShopifyClient {
  const shopDomain = normalizeShopDomain(credentials.shopDomain)
  const apiVersion = resolveApiVersion(credentials.apiVersion)
  const fetchImpl = deps.fetchImpl ?? defaultFetchImpl ?? fetch
  const nestedPageSize = clampNestedPageSize(deps.nestedPageSize ?? SHOPIFY_NESTED_PAGE_SIZE)
  const endpoint = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`
  const clientCredentials = readClientCredentials(credentials)
  const staticAccessToken = readTrimmed(credentials, 'accessToken')

  async function accessToken(): Promise<string> {
    if (clientCredentials) {
      const cacheKey = `${shopDomain}\0${clientCredentials.clientId}\0${clientCredentials.clientSecret}`
      const cached = accessTokenCache.get(cacheKey)
      if (cached && cached.refreshAt > Date.now()) return cached.token
      const pending = accessTokenRequests.get(cacheKey)
      if (pending) return pending
      const request = requestAccessToken(
        fetchImpl,
        shopDomain,
        clientCredentials.clientId,
        clientCredentials.clientSecret,
      ).then((issued) => {
        const lifetimeMs = issued.expiresIn * 1000
        accessTokenCache.set(cacheKey, {
          token: issued.token,
          refreshAt: Date.now() + Math.max(lifetimeMs - TOKEN_REFRESH_MARGIN_MS, Math.min(lifetimeMs, 1_000)),
        })
        return issued.token
      }).finally(() => {
        accessTokenRequests.delete(cacheKey)
      })
      accessTokenRequests.set(cacheKey, request)
      return request
    }
    if (staticAccessToken) return staticAccessToken
    throw new ShopifyClientError('Client ID and client secret are required.')
  }

  async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': await accessToken(),
      },
      body: JSON.stringify({ query, variables }),
    })
    if (!response.ok) {
      throw new ShopifyClientError(`Shopify Admin API returned HTTP ${response.status}.`)
    }
    const payload = await response.json() as GraphqlResponse<T>
    const message = payload.errors?.find((error) => typeof error.message === 'string' && error.message.length > 0)?.message
    if (message) throw new ShopifyClientError(message)
    if (!payload.data) throw new ShopifyClientError('Shopify Admin API returned an empty payload.')
    return payload.data
  }

  function pageOf<T>(connection: unknown, mapNode: (value: unknown) => T | null): ShopifyPage<T> {
    const page = readPageInfo(connection)
    if (page.hasNextPage && !page.endCursor) {
      throw new ShopifyClientError('Shopify returned another page without a cursor.')
    }
    return {
      nodes: connectionNodes(connection).flatMap((node) => {
        const mapped = mapNode(node)
        return mapped ? [mapped] : []
      }),
      endCursor: page.endCursor,
      hasNextPage: page.hasNextPage,
    }
  }

  async function drainVariants(productId: string, firstPage: unknown): Promise<ShopifyVariantNode[]> {
    const first = pageOf(firstPage, mapVariant)
    const variants = [...first.nodes]
    let cursor = first.endCursor
    let hasNextPage = first.hasNextPage
    while (hasNextPage) {
      if (!cursor) throw new ShopifyClientError('Shopify returned another variants page without a cursor.')
      const data = await graphql<{ product?: { variants?: unknown } }>(PRODUCT_VARIANTS_QUERY, {
        id: productId,
        first: nestedPageSize,
        after: cursor,
      })
      const page = pageOf(data.product?.variants, mapVariant)
      variants.push(...page.nodes)
      cursor = page.endCursor
      hasNextPage = page.hasNextPage
    }
    return variants
  }

  async function drainLineItems(orderId: string, firstPage: unknown): Promise<ShopifyOrderLineNode[]> {
    const first = pageOf(firstPage, mapOrderLine)
    const lines = [...first.nodes]
    let cursor = first.endCursor
    let hasNextPage = first.hasNextPage
    while (hasNextPage) {
      if (!cursor) throw new ShopifyClientError('Shopify returned another line-items page without a cursor.')
      const data = await graphql<{ order?: { lineItems?: unknown } }>(ORDER_LINE_ITEMS_QUERY, {
        id: orderId,
        first: nestedPageSize,
        after: cursor,
      })
      const page = pageOf(data.order?.lineItems, mapOrderLine)
      lines.push(...page.nodes)
      cursor = page.endCursor
      hasNextPage = page.hasNextPage
    }
    return lines
  }

  return {
    async shop() {
      const data = await graphql<{ shop?: { name?: string; currencyCode?: string } }>(SHOP_QUERY)
      const name = asString(data.shop?.name)
      const currencyCode = asString(data.shop?.currencyCode)
      if (!name || !currencyCode) throw new ShopifyClientError('Shopify shop payload is missing a name or currency.')
      return { name, currencyCode }
    },
    async listProducts(cursor, batchSize) {
      const data = await graphql<{ products?: unknown }>(PRODUCTS_QUERY, {
        first: clampBatchSize(batchSize),
        after: cursor,
        variantFirst: nestedPageSize,
      })
      const page = readPageInfo(data.products)
      if (page.hasNextPage && !page.endCursor) {
        throw new ShopifyClientError('Shopify returned another page without a cursor.')
      }
      const nodes: ShopifyProductNode[] = []
      for (const raw of connectionNodes(data.products)) {
        const shell = mapProductShell(raw)
        if (!shell) continue
        const variants = await drainVariants(shell.product.id, shell.variantsConnection)
        nodes.push({ ...shell.product, variants })
      }
      return {
        nodes,
        endCursor: page.endCursor,
        hasNextPage: page.hasNextPage,
      }
    },
    async listCustomers(cursor, batchSize) {
      const data = await graphql<{ customers?: unknown }>(CUSTOMERS_QUERY, {
        first: clampBatchSize(batchSize),
        after: cursor,
      })
      return pageOf(data.customers, mapCustomer)
    },
    async listOrders(cursor, batchSize) {
      const data = await graphql<{ orders?: unknown }>(ORDERS_QUERY, {
        first: clampBatchSize(batchSize),
        after: cursor,
        lineFirst: nestedPageSize,
      })
      const page = readPageInfo(data.orders)
      if (page.hasNextPage && !page.endCursor) {
        throw new ShopifyClientError('Shopify returned another page without a cursor.')
      }
      const nodes: ShopifyOrderNode[] = []
      for (const raw of connectionNodes(data.orders)) {
        const shell = mapOrderShell(raw)
        if (!shell) continue
        const lines = await drainLineItems(shell.order.id, shell.lineItemsConnection)
        nodes.push({ ...shell.order, shippingLines: shell.shippingLines, lines })
      }
      return {
        nodes,
        endCursor: page.endCursor,
        hasNextPage: page.hasNextPage,
      }
    },
  }
}
