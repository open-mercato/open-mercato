/** @jest-environment node */

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, callback: () => Promise<unknown>) => callback(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => mockContainer,
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: async () => mockAuth,
  getAuthFromRequest: async () => mockAuth,
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => mockScope,
}))

import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { GET as getQuotes, metadata as quoteMetadata } from '../quotes/route'
import { GET as getOrders } from '../orders/route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const otherOrganizationId = '33333333-3333-4333-8333-333333333333'
const quoteId = '44444444-4444-4444-8444-444444444444'
const orderId = '55555555-5555-4555-8555-555555555555'
const quoteEntity = 'sales:sales_quote'
const orderEntity = 'sales:sales_order'
const updatedAt = '2026-10-22T08:00:00.000Z'

type DocumentRecord = Record<string, unknown> & { id: string }
type DocumentPayload = {
  items: DocumentRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  _meta?: { enrichedBy: string[]; enricherErrors?: string[] }
}
type QueryOptions = {
  tenantId?: string
  organizationId?: string
  organizationIds?: string[]
  filters: { id?: { $eq: string } }
}

let mockAuth: { sub: string; orgId: string; tenantId: string; roles: string[] } | null
let mockScope: { selectedId: string; filterIds: string[]; allowedIds: string[]; tenantId: string }
let mockFeatures: string[]
let mockDocuments: Map<string, DocumentRecord[]>

const mockQuery = jest.fn(async (entityId: string, options: QueryOptions) => {
  const items = (mockDocuments.get(entityId) ?? []).filter((record) => (
    record.tenant_id === options.tenantId
    && options.organizationIds?.includes(String(record.organization_id))
    && (!options.filters.id || record.id === options.filters.id.$eq)
  ))
  return { items, total: items.length }
})
const mockFind = jest.fn(async () => [])
const mockStore = new Map<string, unknown>()
const mockCache = {
  get: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  set: jest.fn(async (key: string, value: unknown) => { mockStore.set(key, value) }),
  delete: jest.fn(async (key: string) => { mockStore.delete(key) }),
  deleteByTags: jest.fn(async () => 0),
}
const mockAccessLog = { log: jest.fn(async () => undefined) }
const mockRbac = { getGrantedFeatures: jest.fn(async () => mockFeatures) }
const mockServices: Record<string, unknown> = {
  em: { find: mockFind },
  queryEngine: { query: mockQuery },
  cache: mockCache,
  accessLogService: mockAccessLog,
  rbacService: mockRbac,
}
const mockContainer = { resolve: (name: string) => mockServices[name] }

function documentFixture(id: string, number: string): DocumentRecord {
  return {
    id,
    quote_number: number,
    order_number: number,
    status: 'draft',
    tenant_id: tenantId,
    organization_id: organizationId,
    currency_code: 'PLN',
    grand_total_gross_amount: '123.45',
    metadata: { source: 'fixture' },
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

function contributor(
  id: string,
  targetEntity: string,
  additions: Record<string, unknown>,
  options: Partial<ResponseEnricher<DocumentRecord>> = {},
) {
  const enrichMany = jest.fn(async (records: DocumentRecord[], _context: EnricherContext) => (
    records.map((record) => ({ ...record, ...additions }))
  ))
  const definition: ResponseEnricher<DocumentRecord> = {
    id,
    targetEntity,
    enrichOne: async (record) => ({ ...record, ...additions }),
    enrichMany,
    ...options,
  }
  return { definition, enrichMany }
}

function register(...enrichers: ResponseEnricher<DocumentRecord>[]) {
  registerResponseEnrichers([{ moduleId: 'sales_test', enrichers }])
}

async function readQuotes(query = '') {
  const response = await getQuotes(new Request(`http://localhost/api/sales/quotes${query}`))
  const payload = await response.json() as DocumentPayload
  return { response, payload }
}

describe('Sales document GET response enrichment (#7783)', () => {
  const previousCacheFlag = process.env.ENABLE_CRUD_API_CACHE

  beforeAll(() => { process.env.ENABLE_CRUD_API_CACHE = 'true' })
  afterAll(() => {
    if (previousCacheFlag === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = previousCacheFlag
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockStore.clear()
    mockFeatures = ['sales.quotes.view', 'sales.orders.view', 'sales_test.view']
    mockAuth = { sub: 'test-user', orgId: organizationId, tenantId, roles: ['employee'] }
    mockScope = { selectedId: organizationId, filterIds: [organizationId], allowedIds: [organizationId], tenantId }
    mockDocuments = new Map([
      [quoteEntity, [documentFixture(quoteId, 'QUOTE-TEST')]],
      [orderEntity, [documentFixture(orderId, 'ORDER-TEST')]],
    ])
    registerResponseEnrichers([])
    registerApiInterceptors([])
  })

  afterEach(() => {
    registerResponseEnrichers([])
    registerApiInterceptors([])
    mockStore.clear()
  })

  it.each(['', `?id=${quoteId}`])('enriches quote headers through the actual GET route for %s', async (query) => {
    const quote = contributor('sales_test.quote', quoteEntity, { _sales_test: { approval: 'review' } })
    register(quote.definition)

    const { response, payload } = await readQuotes(query)

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ total: 1, page: 1, pageSize: 50, totalPages: 1 })
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      id: quoteId,
      quoteNumber: 'QUOTE-TEST',
      status: 'draft',
      currencyCode: 'PLN',
      grandTotalGrossAmount: 123.45,
      tenantId,
      organizationId,
      updatedAt,
      _sales_test: { approval: 'review' },
    })
    expect(payload._meta?.enrichedBy).toEqual(['sales_test.quote'])
    expect(quote.enrichMany).toHaveBeenCalledWith(payload.items.map(({ _sales_test, ...record }) => record), expect.objectContaining({
      targetEntity: quoteEntity,
      tenantId,
      organizationId,
      userId: 'test-user',
      userFeatures: mockFeatures,
      container: mockContainer,
    }))
    expect(mockQuery).toHaveBeenCalledWith(quoteEntity, expect.objectContaining({
      tenantId,
      organizationId,
      organizationIds: [organizationId],
      filters: query ? { id: { $eq: quoteId } } : {},
    }))
    if (query) expect(payload.items[0].metadata).toEqual({ source: 'fixture' })
  })

  it('keeps quote, order and WMS contributors isolated while running wildcard contributors for both entities', async () => {
    const quote = contributor('sales_test.quote', quoteEntity, { _quote: true })
    const order = contributor('sales_test.order', orderEntity, { _order: true })
    const wms = contributor('wms.order-stock', orderEntity, { _wms: { available: true } })
    const wildcard = contributor('sales_test.wildcard', '*', { _shared: true })
    register(quote.definition, order.definition, wms.definition, wildcard.definition)

    const quoteResult = await readQuotes(`?id=${quoteId}`)
    const orderResponse = await getOrders(new Request(`http://localhost/api/sales/orders?id=${orderId}`))
    const orderPayload = await orderResponse.json() as DocumentPayload

    expect(quoteResult.response.status).toBe(200)
    expect(quoteResult.payload.items[0]).toMatchObject({ _quote: true, _shared: true })
    expect(quoteResult.payload.items[0]).not.toHaveProperty('_order')
    expect(quoteResult.payload.items[0]).not.toHaveProperty('_wms')
    expect(quoteResult.payload._meta?.enrichedBy).toEqual(['sales_test.quote', 'sales_test.wildcard'])
    expect(orderResponse.status).toBe(200)
    expect(orderPayload.items[0]).toMatchObject({ _order: true, _wms: { available: true }, _shared: true })
    expect(orderPayload.items[0]).not.toHaveProperty('_quote')
    expect(orderPayload._meta?.enrichedBy).toEqual(['sales_test.order', 'wms.order-stock', 'sales_test.wildcard'])
    expect(quote.enrichMany).toHaveBeenCalledTimes(1)
    expect(order.enrichMany).toHaveBeenCalledTimes(1)
    expect(wms.enrichMany).toHaveBeenCalledTimes(1)
    expect(wildcard.enrichMany.mock.calls.map(([, context]) => context.targetEntity)).toEqual([quoteEntity, orderEntity])
  })

  it('preserves the base envelope without contributors and retains route authorization metadata', async () => {
    const { response, payload } = await readQuotes(`?id=${quoteId}`)
    expect(response.status).toBe(200)
    expect(Object.keys(payload).sort()).toEqual(['items', 'page', 'pageSize', 'total', 'totalPages'])
    expect(payload.items[0].quoteNumber).toBe('QUOTE-TEST')
    expect(quoteMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['sales.quotes.view'] })
    mockAuth = null
    const unauthenticated = await getQuotes(new Request('http://localhost/api/sales/quotes'))
    expect(unauthenticated.status).toBe(401)
  })

  it('gates enrichment by wildcard-aware features and partitions cached enriched payloads by entitlement', async () => {
    const quote = contributor('sales_test.restricted', quoteEntity, { _sales_test: { confidential: true } }, {
      features: ['sales_test.view'],
      cacheableOnListHit: true,
    })
    register(quote.definition)
    mockFeatures = ['sales.quotes.view', 'sales_test.*']
    const authorized = await readQuotes()
    const hit = await readQuotes()
    expect(authorized.payload.items[0]._sales_test).toEqual({ confidential: true })
    expect(hit.response.headers.get('x-om-cache')).toBe('hit')
    expect(quote.enrichMany).toHaveBeenCalledTimes(1)

    mockFeatures = ['sales.quotes.view']
    const denied = await readQuotes()
    expect(denied.response.status).toBe(200)
    expect(denied.response.headers.get('x-om-cache')).toBe('miss')
    expect(denied.payload.items[0]).not.toHaveProperty('_sales_test')
    expect(denied.payload).not.toHaveProperty('_meta')
    expect(quote.enrichMany).toHaveBeenCalledTimes(1)
  })

  it('retains request scope in records, enrichment context, and cache keys', async () => {
    const otherQuoteId = '66666666-6666-4666-8666-666666666666'
    const otherTenantId = '77777777-7777-4777-8777-777777777777'
    const otherTenantQuoteId = '88888888-8888-4888-8888-888888888888'
    mockDocuments.get(quoteEntity)?.push(
      { ...documentFixture(otherQuoteId, 'OTHER-QUOTE'), organization_id: otherOrganizationId },
      { ...documentFixture(otherTenantQuoteId, 'OTHER-TENANT-QUOTE'), tenant_id: otherTenantId, organization_id: otherOrganizationId },
    )
    const quote = contributor('sales_test.scoped', quoteEntity, { _sales_test: { checked: true } })
    register(quote.definition)
    const first = await readQuotes()
    expect(first.payload.items.map((record) => record.id)).toEqual([quoteId])

    mockScope = { ...mockScope, selectedId: otherOrganizationId, filterIds: [otherOrganizationId], allowedIds: [otherOrganizationId] }
    const second = await readQuotes()
    expect(second.response.headers.get('x-om-cache')).toBe('miss')
    expect(second.payload.items.map((record) => record.id)).toEqual([otherQuoteId])
    expect(quote.enrichMany.mock.calls.map(([, context]) => context.organizationId)).toEqual([organizationId, otherOrganizationId])
    expect(mockFind).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      documentId: { $in: [otherQuoteId] },
      documentKind: 'quote',
      tenantId,
      organizationId: { $in: [otherOrganizationId] },
    }), { populate: ['tag'] })

    mockScope = { ...mockScope, tenantId: otherTenantId }
    const otherTenant = await readQuotes()
    expect(otherTenant.response.headers.get('x-om-cache')).toBe('miss')
    expect(otherTenant.payload.items.map((record) => record.id)).toEqual([otherTenantQuoteId])
    expect(quote.enrichMany).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({
      tenantId: otherTenantId,
      organizationId: otherOrganizationId,
    }))
  })

  it('serves noncritical fallback without changing base quote fields or pagination', async () => {
    const failed = contributor('sales_test.unavailable', quoteEntity, {}, {
      fallback: { _sales_test: { unavailable: true } },
      enrichMany: async () => { throw new Error('[internal] unavailable fixture') },
    })
    register(failed.definition)
    const { response, payload } = await readQuotes(`?id=${quoteId}`)
    expect(response.status).toBe(200)
    expect(payload.items[0]).toMatchObject({ id: quoteId, quoteNumber: 'QUOTE-TEST', updatedAt, _sales_test: { unavailable: true } })
    expect(payload).toMatchObject({ total: 1, page: 1, pageSize: 50, totalPages: 1 })
    expect(payload._meta?.enricherErrors).toEqual(['sales_test.unavailable'])
  })

  it('reruns live quote enrichers on cached lists instead of serving stale cross-module data', async () => {
    let approval = 'review'
    const live = contributor('sales_test.live', quoteEntity, {}, {
      enrichMany: async (records) => records.map((record) => ({ ...record, _sales_test: { approval } })),
    })
    register(live.definition)
    const first = await readQuotes()
    approval = 'approved'
    const second = await readQuotes()
    expect(first.payload.items[0]._sales_test).toEqual({ approval: 'review' })
    expect(second.response.headers.get('x-om-cache')).toBe('hit')
    expect(second.payload.items[0]._sales_test).toEqual({ approval: 'approved' })
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})
