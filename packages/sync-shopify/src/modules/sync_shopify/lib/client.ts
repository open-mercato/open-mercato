import {
  DEFAULT_SHOPIFY_API_VERSION,
  SHOPIFY_API_VERSIONS,
  type ShopifyCustomerNode,
  type ShopifyMoney,
  type ShopifyOrderLineNode,
  type ShopifyOrderNode,
  type ShopifyPage,
  type ShopifyProductNode,
  type ShopifyShop,
  type ShopifyVariantNode,
} from './types'

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/
const MAX_BATCH_SIZE = 25

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

function mapProduct(value: unknown): ShopifyProductNode | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  if (!record || !id) return null
  return {
    id,
    title: asString(record.title) ?? 'Untitled product',
    descriptionHtml: asString(record.descriptionHtml),
    handle: asString(record.handle) ?? id,
    status: asString(record.status) ?? 'DRAFT',
    vendor: asString(record.vendor),
    productType: asString(record.productType),
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    variants: connectionNodes(record.variants).flatMap((node) => {
      const variant = mapVariant(node)
      return variant ? [variant] : []
    }),
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

function mapOrderLine(value: unknown): ShopifyOrderLineNode | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  if (!record || !id) return null
  const quantity = typeof record.quantity === 'number' ? record.quantity : Number(record.quantity)
  return {
    id,
    title: asString(record.title) ?? 'Line',
    sku: asString(record.sku),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    variantId: asString(asRecord(record.variant)?.id),
    unitPrice: asMoney(record.originalUnitPriceSet),
  }
}

function mapOrder(value: unknown): ShopifyOrderNode | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  if (!record || !id) return null
  return {
    id,
    name: asString(record.name) ?? id,
    email: asString(record.email),
    createdAt: asString(record.createdAt) ?? new Date(0).toISOString(),
    currencyCode: asString(record.currencyCode) ?? '',
    displayFinancialStatus: asString(record.displayFinancialStatus),
    displayFulfillmentStatus: asString(record.displayFulfillmentStatus),
    customerId: asString(asRecord(record.customer)?.id),
    total: asMoney(record.totalPriceSet),
    lines: connectionNodes(record.lineItems).flatMap((node) => {
      const line = mapOrderLine(node)
      return line ? [line] : []
    }),
  }
}

const PRODUCTS_QUERY = `
  query ShopifyProducts($first: Int!, $after: String) {
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
        variants(first: 100) {
          nodes { id sku barcode title price compareAtPrice selectedOptions { name value } }
        }
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
  query ShopifyOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        email
        createdAt
        currencyCode
        displayFinancialStatus
        displayFulfillmentStatus
        customer { id }
        totalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 50) {
          nodes {
            id
            title
            sku
            quantity
            variant { id }
            originalUnitPriceSet { shopMoney { amount currencyCode } }
          }
        }
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
  const fetchImpl = deps.fetchImpl ?? fetch
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
      })
      return pageOf(data.products, mapProduct)
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
      })
      return pageOf(data.orders, mapOrder)
    },
  }
}
