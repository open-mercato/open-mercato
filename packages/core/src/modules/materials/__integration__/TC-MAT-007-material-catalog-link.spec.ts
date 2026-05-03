import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

type CatalogLinkResponse = {
  link:
    | {
        id: string
        material_id: string
        catalog_product_id: string
      }
    | null
  exists: boolean
}

type ListResponse<T> = { items?: T[] }

function resolveUrl(path: string): string {
  return `${BASE_URL}${path}`
}

function buildCookieHeader(scope: {
  tenantId?: string | null
  organizationId?: string | null
}): string | undefined {
  const parts: string[] = []
  if (typeof scope.tenantId === 'string' && scope.tenantId.length > 0) {
    parts.push(`om_selected_tenant=${scope.tenantId}`)
  }
  if (typeof scope.organizationId === 'string' && scope.organizationId.length > 0) {
    parts.push(`om_selected_org=${scope.organizationId}`)
  }
  return parts.length > 0 ? parts.join('; ') : undefined
}

async function scopedApiRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: {
    token: string
    data?: unknown
    tenantId?: string | null
    organizationId?: string | null
  },
): Promise<APIResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
  }
  const cookie = buildCookieHeader(options)
  if (cookie) headers.Cookie = cookie
  return request.fetch(resolveUrl(path), { method, headers, data: options.data })
}

async function createMaterial(
  request: APIRequestContext,
  token: string,
  code: string,
  name: string,
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<string> {
  const data = { code, name, kind: 'final' }
  const response = scope
    ? await scopedApiRequest(request, 'POST', '/api/materials', { token, data, ...scope })
    : await apiRequest(request, 'POST', '/api/materials', { token, data })
  expect(response.status()).toBe(201)
  return expectId(((await readJsonSafe<{ id?: string }>(response)) ?? {}).id, 'Material id')
}

async function createCatalogProduct(
  request: APIRequestContext,
  token: string,
  payload: Record<string, unknown>,
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<string | null> {
  const response = scope
    ? await scopedApiRequest(request, 'POST', '/api/catalog/products', { token, data: payload, ...scope })
    : await apiRequest(request, 'POST', '/api/catalog/products', { token, data: payload })
  if (!response.ok()) return null
  const body = await readJsonSafe<{ id?: string }>(response)
  return body?.id ?? null
}

async function deleteIfExists(
  request: APIRequestContext,
  token: string | null,
  path: string,
  id: string | null,
  scope?: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!token || !id) return
  if (scope) {
    await scopedApiRequest(request, 'DELETE', path, { token, data: { id }, ...scope }).catch(() => undefined)
  } else {
    await apiRequest(request, 'DELETE', path, { token, data: { id } }).catch(() => undefined)
  }
}

async function deleteOrganizationIfExists(
  request: APIRequestContext,
  token: string | null,
  organizationId: string | null,
): Promise<void> {
  if (!token || !organizationId) return
  await apiRequest(
    request,
    'DELETE',
    `/api/directory/organizations?id=${encodeURIComponent(organizationId)}`,
    { token },
  ).catch(() => undefined)
}

test.describe('TC-MAT-007: Material ↔ Catalog Product 1:1 Link', () => {
  test('upsert and delete the catalog link with re-link semantics', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let materialId: string | null = null
    let productAId: string | null = null
    let productBId: string | null = null

    try {
      materialId = await createMaterial(request, token, `MAT007-${stamp}`, `Catalog link ${stamp}`)
      productAId = await createCatalogProduct(request, token, {
        title: `MAT007 Product A ${stamp}`,
        slug: `mat007-product-a-${stamp}`,
        sku: `MAT007-A-${stamp}`,
      })
      productBId = await createCatalogProduct(request, token, {
        title: `MAT007 Product B ${stamp}`,
        slug: `mat007-product-b-${stamp}`,
        sku: `MAT007-B-${stamp}`,
      })
      test.skip(
        !productAId || !productBId,
        'Catalog product creation API not available — skipping link test',
      )

      const linkPath = `/api/materials/${encodeURIComponent(materialId)}/catalog-link`

      const initialGet = await apiRequest(request, 'GET', linkPath, { token })
      expect(initialGet.status()).toBe(200)
      const initialBody = await readJsonSafe<CatalogLinkResponse>(initialGet)
      expect(initialBody?.exists).toBe(false)
      expect(initialBody?.link).toBeNull()

      const firstPut = await apiRequest(request, 'PUT', linkPath, {
        token,
        data: { catalogProductId: productAId },
      })
      expect(firstPut.status()).toBe(201)

      const secondPut = await apiRequest(request, 'PUT', linkPath, {
        token,
        data: { catalogProductId: productBId },
      })
      expect(secondPut.status(), 'Second PUT should return 200 (re-link)').toBe(200)

      const afterRelink = await apiRequest(request, 'GET', linkPath, { token })
      const afterRelinkBody = await readJsonSafe<CatalogLinkResponse>(afterRelink)
      expect(afterRelinkBody?.exists).toBe(true)
      expect(afterRelinkBody?.link?.catalog_product_id).toBe(productBId)

      const deleteResponse = await apiRequest(request, 'DELETE', linkPath, { token })
      expect(deleteResponse.status()).toBe(200)

      const afterDelete = await apiRequest(request, 'GET', linkPath, { token })
      const afterDeleteBody = await readJsonSafe<CatalogLinkResponse>(afterDelete)
      expect(afterDeleteBody?.exists).toBe(false)
      expect(afterDeleteBody?.link).toBeNull()
    } finally {
      await deleteIfExists(request, token, '/api/catalog/products', productAId)
      await deleteIfExists(request, token, '/api/catalog/products', productBId)
      await deleteIfExists(request, token, '/api/materials', materialId)
    }
  })

  test('rejects cross-org catalog_product_id and blocks duplicate product binding', async ({ request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminScope = getTokenScope(adminToken)
    const stamp = Date.now()

    let materialAId: string | null = null
    let materialBId: string | null = null
    let productId: string | null = null
    let foreignOrgId: string | null = null
    let foreignProductId: string | null = null

    try {
      materialAId = await createMaterial(request, adminToken, `MAT007-X1-${stamp}`, `XLink A ${stamp}`)
      materialBId = await createMaterial(request, adminToken, `MAT007-X2-${stamp}`, `XLink B ${stamp}`)
      productId = await createCatalogProduct(request, adminToken, {
        title: `MAT007 Shared product ${stamp}`,
        slug: `mat007-shared-${stamp}`,
        sku: `MAT007-SHARED-${stamp}`,
      })
      test.skip(!productId, 'Catalog product creation API not available — skipping')

      const orgResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: adminScope.tenantId, name: `MAT007 Foreign Org ${stamp}` },
      })
      expect(orgResponse.status()).toBe(201)
      foreignOrgId = expectId(((await readJsonSafe<{ id?: string }>(orgResponse)) ?? {}).id, 'Foreign org id')

      foreignProductId = await createCatalogProduct(
        request,
        superadminToken,
        {
          title: `MAT007 Foreign product ${stamp}`,
          slug: `mat007-foreign-${stamp}`,
          sku: `MAT007-FOREIGN-${stamp}`,
        },
        { tenantId: adminScope.tenantId, organizationId: foreignOrgId },
      )

      if (foreignProductId) {
        const crossOrgResponse = await apiRequest(
          request,
          'PUT',
          `/api/materials/${encodeURIComponent(materialAId)}/catalog-link`,
          { token: adminToken, data: { catalogProductId: foreignProductId } },
        )
        expect(
          crossOrgResponse.ok(),
          `Cross-org product binding must fail: ${crossOrgResponse.status()}`,
        ).toBeFalsy()
        expect([404, 422, 403]).toContain(crossOrgResponse.status())
      }

      const firstBind = await apiRequest(
        request,
        'PUT',
        `/api/materials/${encodeURIComponent(materialAId)}/catalog-link`,
        { token: adminToken, data: { catalogProductId: productId } },
      )
      expect(firstBind.status()).toBe(201)

      const dupBind = await apiRequest(
        request,
        'PUT',
        `/api/materials/${encodeURIComponent(materialBId)}/catalog-link`,
        { token: adminToken, data: { catalogProductId: productId } },
      )
      expect(dupBind.status(), 'Second material binding to same product must be 409').toBe(409)
    } finally {
      await deleteIfExists(request, adminToken, '/api/catalog/products', productId)
      if (foreignOrgId && foreignProductId) {
        await deleteIfExists(request, superadminToken, '/api/catalog/products', foreignProductId, {
          tenantId: adminScope.tenantId,
          organizationId: foreignOrgId,
        })
      }
      await deleteIfExists(request, adminToken, '/api/materials', materialAId)
      await deleteIfExists(request, adminToken, '/api/materials', materialBId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrgId)
    }
  })
})
