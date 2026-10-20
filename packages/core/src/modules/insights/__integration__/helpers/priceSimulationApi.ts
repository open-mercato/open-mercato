import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { OPTIMISTIC_LOCK_HEADER, uniqueSuffix } from './simulationApi'

export const PRICE_BACKTEST_KIND = 'catalog.price_backtest'
export const CATALOG_PRICES_PATH = '/api/catalog/prices'
export const CATALOG_PRICE_KINDS_PATH = '/api/catalog/price-kinds'
export const CATALOG_PRODUCTS_PATH = '/api/catalog/products'
export const SALES_ORDERS_PATH = '/api/sales/orders'
export const SALES_QUOTES_PATH = '/api/sales/quotes'
export const SALES_ORDER_LINES_PATH = '/api/sales/order-lines'
export const SALES_QUOTE_LINES_PATH = '/api/sales/quote-lines'

/** What a price backtest needs (pricing + both document families), plus authoring its fixtures and applying the row. */
export const PRICE_SIMULATOR_FEATURES = [
  'insights.simulator.view',
  'insights.simulator.run',
  'catalog.products.view',
  'catalog.products.manage',
  'catalog.pricing.manage',
  'catalog.settings.manage',
  'sales.orders.view',
  'sales.orders.manage',
  'sales.quotes.view',
  'sales.quotes.manage',
  'currencies.view',
  'dictionaries.view',
  'progress.view',
]

type JsonRecord = Record<string, unknown>

async function postJson(request: APIRequestContext, token: string, path: string, data: JsonRecord): Promise<JsonRecord> {
  const response = await apiRequest(request, 'POST', path, { token, data, retryTransport: false })
  const text = await response.text()
  expect(response.ok(), `POST ${path}: ${response.status()} ${text.slice(0, 500)}`).toBeTruthy()
  return text ? (JSON.parse(text) as JsonRecord) : {}
}

function readId(body: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  throw new Error(`[internal] no id among ${keys.join(', ')} in ${JSON.stringify(body).slice(0, 200)}`)
}

export async function createPriceProduct(request: APIRequestContext, token: string, label: string): Promise<string> {
  const suffix = uniqueSuffix()
  const body = await postJson(request, token, CATALOG_PRODUCTS_PATH, {
    title: `QA ${label} ${suffix}`,
    sku: `QA-${label}-${suffix}`.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 60),
    description: 'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.',
  })
  return readId(body, ['id'])
}

export async function createNetPriceKind(request: APIRequestContext, token: string, label: string): Promise<string> {
  const suffix = uniqueSuffix()
  const body = await postJson(request, token, CATALOG_PRICE_KINDS_PATH, {
    code: `qa_${label}_${suffix}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60),
    title: `QA ${label} ${suffix}`,
    displayMode: 'excluding-tax',
    currencyCode: 'EUR',
  })
  return readId(body, ['id'])
}

export async function createEurPriceRow(request: APIRequestContext, token: string, input: { productId: string; priceKindId: string; unitPriceNet: number }): Promise<string> {
  const body = await postJson(request, token, CATALOG_PRICES_PATH, {
    productId: input.productId,
    priceKindId: input.priceKindId,
    currencyCode: 'EUR',
    minQuantity: 1,
    unitPriceNet: input.unitPriceNet,
    taxRate: 0,
  })
  return readId(body, ['id', 'priceId'])
}

export async function readPriceRow(request: APIRequestContext, token: string, priceId: string): Promise<{ updatedAt: string; unitPriceNet: number | null; unitPriceGross: number | null }> {
  const response = await apiRequest(request, 'GET', `${CATALOG_PRICES_PATH}?ids=${encodeURIComponent(priceId)}&pageSize=1`, { token })
  const text = await response.text()
  expect(response.status(), `GET ${CATALOG_PRICES_PATH}: ${text.slice(0, 300)}`).toBe(200)
  const item = (JSON.parse(text) as { items?: JsonRecord[] }).items?.[0]
  expect(item, 'the price row is listed').toBeTruthy()
  const updatedAt = (item?.updated_at ?? item?.updatedAt) as string | undefined
  expect(updatedAt, 'the price row exposes updated_at').toBeTruthy()
  return {
    updatedAt: updatedAt as string,
    unitPriceNet: typeof item?.unit_price_net === 'number' ? item.unit_price_net : Number(item?.unit_price_net ?? Number.NaN),
    unitPriceGross: typeof item?.unit_price_gross === 'number' ? item.unit_price_gross : Number(item?.unit_price_gross ?? Number.NaN),
  }
}

export type PriceRowRef = {
  priceId: string
  productId: string
  priceKindId: string
  currencyCode: string
}

/**
 * Saves a new net amount the way the price row edit form does (product, price kind and currency
 * are sent along; the gross amount is derived on save) with the optimistic lock header; answers
 * the HTTP status.
 */
export async function updatePriceRowNet(request: APIRequestContext, token: string, input: PriceRowRef & { unitPriceNet: number; updatedAt: string }): Promise<{ status: number; text: string }> {
  const response = await apiRequest(request, 'PUT', CATALOG_PRICES_PATH, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER]: input.updatedAt },
    data: {
      id: input.priceId,
      productId: input.productId,
      priceKindId: input.priceKindId,
      currencyCode: input.currencyCode,
      unitPriceNet: input.unitPriceNet,
    },
  })
  return { status: response.status(), text: await response.text() }
}

export async function createDocument(request: APIRequestContext, token: string, kind: 'order' | 'quote', currencyCode: string): Promise<string> {
  if (kind === 'quote') return readId(await postJson(request, token, SALES_QUOTES_PATH, { currencyCode }), ['id', 'quoteId'])
  const body = await postJson(request, token, SALES_ORDERS_PATH, {
    currencyCode,
    lines: [{ currencyCode, quantity: 1, name: `QA seed line ${uniqueSuffix()}`, unitPriceNet: 0, unitPriceGross: 0 }],
  })
  return readId(body, ['id', 'orderId'])
}

export type CatalogLineInput = {
  documentId: string
  productId: string
  priceId: string
  currencyCode: string
  quantity: number
  unitPrice: number
}

/**
 * A line added the way the browser line dialog adds one priced from a catalog row: `priceId` and
 * `priceMode` both as top-level fields and in `metadata` (`LineItemDialog`), net entry, tax 0.
 */
export async function createCatalogLine(request: APIRequestContext, token: string, kind: 'order' | 'quote', input: CatalogLineInput): Promise<string> {
  const path = kind === 'order' ? SALES_ORDER_LINES_PATH : SALES_QUOTE_LINES_PATH
  const body = await postJson(request, token, path, {
    [kind === 'order' ? 'orderId' : 'quoteId']: input.documentId,
    productId: input.productId,
    quantity: input.quantity,
    currencyCode: input.currencyCode,
    priceId: input.priceId,
    priceMode: 'net',
    taxRate: 0,
    unitPriceNet: input.unitPrice,
    unitPriceGross: input.unitPrice,
    totalNetAmount: input.unitPrice * input.quantity,
    totalGrossAmount: input.unitPrice * input.quantity,
    metadata: { priceId: input.priceId, priceMode: 'net', lineMode: 'catalog' },
    name: `QA price line ${uniqueSuffix()}`,
  })
  return readId(body, ['id', 'lineId'])
}

/** A manual price change of an existing order line (the line keeps its price link). */
export async function overrideOrderLinePrice(request: APIRequestContext, token: string, input: { documentId: string; lineId: string; currencyCode: string; quantity: number; unitPrice: number }): Promise<void> {
  const response = await apiRequest(request, 'PUT', SALES_ORDER_LINES_PATH, {
    token,
    data: {
      id: input.lineId,
      orderId: input.documentId,
      currencyCode: input.currencyCode,
      quantity: input.quantity,
      unitPriceNet: input.unitPrice,
      unitPriceGross: input.unitPrice,
      taxRate: 0,
    },
  })
  const text = await response.text()
  expect(response.status(), `PUT ${SALES_ORDER_LINES_PATH}: ${text.slice(0, 300)}`).toBe(200)
}

/** Removes the catalog and sales rows of a fixture organization the API deletes left behind (soft-deleted documents and their lines). */
export async function purgePriceFixtureRows(organizationId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from sales_order_lines where organization_id = $1', [organizationId])
    await client.query('delete from sales_quote_lines where organization_id = $1', [organizationId])
    await client.query('delete from sales_orders where organization_id = $1', [organizationId])
    await client.query('delete from sales_quotes where organization_id = $1', [organizationId])
    await client.query('delete from catalog_product_variant_prices where organization_id = $1', [organizationId])
  }).catch(() => undefined)
}
