/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const variantId = '33333333-3333-4333-8333-333333333333'

const query = jest.fn()
const resolveContainerService = jest.fn((name: string) => {
  if (name === 'queryEngine') return { query }
  throw new Error(`unexpected resolve: ${name}`)
})
const container = { resolve: resolveContainerService }
const resolveOrganizationScopeForRequestMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { E } from '#generated/entities.ids.generated'
import { GET, metadata } from '../route'

const createRequestContainerMock = createRequestContainer as jest.Mock
const getAuthFromRequestMock = getAuthFromRequest as jest.Mock

describe('GET /api/wms/catalog-variant-labels', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({
      sub: 'user-1',
      tenantId,
      orgId: organizationId,
    })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    })
    query.mockResolvedValue({
      items: [{
        id: variantId,
        sku: 'SKU-1',
        name: 'Widget',
        is_active: false,
        barcode: '999',
        metadata: { cost: 12 },
      }],
      total: 1,
    })
  })

  it('requires wms.view and does not require catalog read', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['wms.view'] })
  })

  it('scopes the lookup to the session and returns only label fields', async () => {
    const response = await GET(new Request(
      `http://localhost/api/wms/catalog-variant-labels?search=${encodeURIComponent('wid_get%')}&organizationId=99999999-9999-4999-8999-999999999999&fields=barcode`,
    ))

    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledWith(E.catalog.catalog_product_variant, {
      tenantId,
      organizationId,
      filters: {
        $or: [
          { name: { $ilike: '%widget%' } },
          { sku: { $ilike: '%widget%' } },
          { barcode: { $ilike: '%widget%' } },
        ],
      },
      fields: ['id', 'name', 'sku', 'is_active'],
      sort: [{ field: 'sku', dir: 'asc' }],
      page: { page: 1, pageSize: 25 },
    })
    await expect(response.json()).resolves.toEqual({
      items: [{ id: variantId, sku: 'SKU-1', name: 'Widget', is_active: false }],
      total: 1,
      totalPages: 1,
    })
  })

  it('rejects an oversized page before querying', async () => {
    const response = await GET(new Request('http://localhost/api/wms/catalog-variant-labels?pageSize=101'))

    expect(response.status).toBe(400)
    expect(createRequestContainerMock).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a caller without a tenant', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: 'user-1', tenantId: null, orgId: organizationId })

    const response = await GET(new Request('http://localhost/api/wms/catalog-variant-labels'))

    expect(response.status).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('denies an explicitly empty organization scope', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: null,
      filterIds: [],
      allowedIds: [],
      tenantId,
    })

    const response = await GET(new Request('http://localhost/api/wms/catalog-variant-labels'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(query).not.toHaveBeenCalled()
  })

  it('asks for an organization when the session has none selected', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: 'user-1', tenantId, orgId: null })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: null,
      tenantId,
    })

    const response = await GET(new Request('http://localhost/api/wms/catalog-variant-labels'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Select an organization to access this resource',
      code: 'organization_scope_required',
    })
    expect(query).not.toHaveBeenCalled()
  })
})
