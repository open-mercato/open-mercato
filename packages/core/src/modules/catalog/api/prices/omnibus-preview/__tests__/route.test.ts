const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const otherOrganizationId = '88888888-8888-4888-8888-888888888888'
const userId = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'
const priceKindId = '55555555-5555-4555-8555-555555555555'
const priceId = '66666666-6666-4666-8666-666666666666'
const variantId = '77777777-7777-4777-8777-777777777777'
const otherProductId = '99999999-9999-4999-8999-999999999999'
const channelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type Scope = { selectedId: string | null; filterIds: string[] | null; allowedIds: string[] | null; tenantId: string | null }

let authValue: Record<string, unknown> | null = null
let scopeValue: Scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const presentedEntriesMock = jest.fn()
const resolveOmnibusBlockMock = jest.fn()

const em = { fork: () => em }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'catalogOmnibusService') return { resolveOmnibusBlock: resolveOmnibusBlockMock }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => scopeValue),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('../../../../lib/omnibusPresentedEntry', () => ({
  resolveOmnibusPresentedEntries: (...args: unknown[]) => presentedEntriesMock(...args),
}))

import { GET, metadata, openApi } from '../route'
import {
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductVariant,
} from '../../../../data/entities'

const block = {
  presentedPriceKindId: priceKindId,
  lookbackDays: 30,
  minimizationAxis: 'gross',
  promotionAnchorAt: '2026-06-01T00:00:00.000Z',
  windowStart: '2026-05-02T00:00:00.000Z',
  windowEnd: '2026-06-01T00:00:00.000Z',
  coverageStartAt: null,
  lowestPriceNet: '81.3008',
  lowestPriceGross: '100.0000',
  previousPriceNet: '81.3008',
  previousPriceGross: '100.0000',
  currencyCode: 'PLN',
  applicable: true,
  applicabilityReason: 'announced_promotion',
}

const presentedEntry = {
  priceId,
  changeType: 'update',
  recordedAt: '2026-06-01T00:00:00.000Z',
  startsAt: '2026-06-01T00:00:00.000Z',
}

type Records = {
  product?: Record<string, unknown> | null
  variant?: Record<string, unknown> | null
  priceKind?: Record<string, unknown> | null
}

let records: Records = {}

function previewUrl(params: Record<string, string>): Request {
  const url = new URL('http://localhost/api/catalog/prices/omnibus-preview')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Request(url.toString())
}

function setupRecords(overrides: Records = {}) {
  records = {
    product: { id: productId, tenantId, organizationId },
    variant: { id: variantId, tenantId, organizationId, product: { id: productId } },
    priceKind: { id: priceKindId, tenantId, organizationId: null, isPromotion: true },
    ...overrides,
  }
  findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === CatalogProduct) return records.product && where.id === records.product.id ? records.product : null
    if (entity === CatalogProductVariant) return records.variant && where.id === records.variant.id ? records.variant : null
    if (entity === CatalogPriceKind) return records.priceKind
    return null
  })
  findWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity !== CatalogProductPrice) return []
    return [
      {
        id: priceId,
        tenantId,
        organizationId,
        currencyCode: 'PLN',
        kind: 'promotion',
        minQuantity: 1,
        maxQuantity: null,
        channelId: null,
        startsAt: new Date('2026-06-01T00:00:00.000Z'),
        endsAt: null,
        priceKind: { id: priceKindId, code: 'promo', isPromotion: true },
        product: { id: productId },
        variant: null,
        offer: null,
      },
    ]
  })
}

describe('GET /api/catalog/prices/omnibus-preview', () => {
  beforeEach(() => {
    authValue = { sub: userId, tenantId, orgId: organizationId }
    scopeValue = { selectedId: organizationId, filterIds: [organizationId], allowedIds: [organizationId], tenantId }
    findOneWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockReset()
    presentedEntriesMock.mockReset()
    resolveOmnibusBlockMock.mockReset()
    presentedEntriesMock.mockImplementation(async () => new Map([[priceId, presentedEntry]]))
    resolveOmnibusBlockMock.mockResolvedValue(block)
    setupRecords()
  })

  it('requires catalog.price_history.view and documents the route', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['catalog.price_history.view'] })
    expect(openApi.methods.GET).toBeDefined()
  })

  it('returns 401 when unauthenticated', async () => {
    authValue = null
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', productId }))
    expect(response.status).toBe(401)
  })

  it.each([
    ['missing priceKindId', { currencyCode: 'PLN', productId }],
    ['missing currencyCode', { priceKindId, productId }],
    ['no scope identifier', { priceKindId, currencyCode: 'PLN' }],
    ['invalid currency', { priceKindId, currencyCode: 'PL1', productId }],
    ['non-uuid product', { priceKindId, currencyCode: 'PLN', productId: 'nope' }],
    ['unknown parameter', { priceKindId, currencyCode: 'PLN', productId, extra: '1' }],
  ])('returns 400 for %s', async (_label, params) => {
    const response = await GET(previewUrl(params as Record<string, string>))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid query')
    expect(resolveOmnibusBlockMock).not.toHaveBeenCalled()
  })

  it('resolves the block with the presented entry and the product organization scope', async () => {
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'pln', productId, channelId }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(block)
    const productWhere = findOneWithDecryptionMock.mock.calls.find(([, entity]) => entity === CatalogProduct)?.[2]
    expect(productWhere).toEqual({
      id: productId,
      tenantId,
      deletedAt: null,
      organizationId: { $in: [organizationId] },
    })
    const priceWhere = findWithDecryptionMock.mock.calls[0][2]
    expect(priceWhere).toMatchObject({ tenantId, organizationId, priceKind: priceKindId, currencyCode: 'PLN' })
    expect(presentedEntriesMock).toHaveBeenCalledWith(em, [expect.objectContaining({ id: priceId })])
    expect(resolveOmnibusBlockMock).toHaveBeenCalledWith(
      em,
      {
        tenantId,
        organizationId,
        productId,
        variantId: null,
        offerId: null,
        channelId,
        priceKindId,
        currencyCode: 'PLN',
        isStorefront: false,
      },
      presentedEntry,
      true,
    )
  })

  it('returns null when omnibus is disabled', async () => {
    resolveOmnibusBlockMock.mockResolvedValue(null)
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', productId }))
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })

  it('passes a null presented entry when no active price of the kind exists', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', productId }))
    expect(response.status).toBe(200)
    expect(presentedEntriesMock).not.toHaveBeenCalled()
    expect(resolveOmnibusBlockMock.mock.calls[0][2]).toBeNull()
  })

  it('derives the product from a variant', async () => {
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', variantId }))
    expect(response.status).toBe(200)
    expect(resolveOmnibusBlockMock.mock.calls[0][1]).toMatchObject({ productId, variantId })
  })

  it('returns 404 when the variant belongs to a different product', async () => {
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', variantId, productId: otherProductId }))
    expect(response.status).toBe(404)
    expect(resolveOmnibusBlockMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the product is outside the caller scope', async () => {
    setupRecords({ product: null })
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', productId }))
    expect(response.status).toBe(404)
    expect(resolveOmnibusBlockMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the price kind is not visible to the tenant', async () => {
    setupRecords({ priceKind: null })
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', productId }))
    expect(response.status).toBe(404)
  })

  it('returns 404 without querying when the caller has no organization access', async () => {
    authValue = { sub: userId, tenantId, orgId: null }
    scopeValue = { selectedId: null, filterIds: [], allowedIds: [], tenantId }
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', productId }))
    expect(response.status).toBe(404)
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('scopes reads to every organization in a multi-organization scope', async () => {
    scopeValue = {
      selectedId: null,
      filterIds: [organizationId, otherOrganizationId],
      allowedIds: [organizationId, otherOrganizationId],
      tenantId,
    }
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', productId }))
    expect(response.status).toBe(200)
    const productWhere = findOneWithDecryptionMock.mock.calls.find(([, entity]) => entity === CatalogProduct)?.[2]
    expect(productWhere.organizationId).toEqual({ $in: [organizationId, otherOrganizationId] })
    expect(resolveOmnibusBlockMock.mock.calls[0][1].organizationId).toBe(organizationId)
  })

  it('returns 500 when resolution throws', async () => {
    resolveOmnibusBlockMock.mockRejectedValue(new Error('boom'))
    const response = await GET(previewUrl({ priceKindId, currencyCode: 'PLN', productId }))
    expect(response.status).toBe(500)
  })
})
