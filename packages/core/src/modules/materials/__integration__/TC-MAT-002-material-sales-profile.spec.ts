import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

type MaterialListItem = {
  id: string
  code: string
  is_sellable: boolean
}

type ListResponse = { items?: MaterialListItem[] }

type SalesProfileResponse = {
  profile:
    | {
        id: string
        material_id: string
        gtin: string | null
        commodity_code: string | null
      }
    | null
  exists: boolean
}

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

async function getMaterialById(
  request: APIRequestContext,
  token: string,
  id: string,
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<MaterialListItem | null> {
  const path = `/api/materials?ids=${encodeURIComponent(id)}&page=1&pageSize=10`
  const response = scope
    ? await scopedApiRequest(request, 'GET', path, { token, ...scope })
    : await apiRequest(request, 'GET', path, { token })
  const body = await readJsonSafe<ListResponse>(response)
  return body?.items?.find((row) => row.id === id) ?? null
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
  expect(response.status(), `Material create failed: ${response.status()}`).toBe(201)
  return expectId(((await readJsonSafe<{ id?: string }>(response)) ?? {}).id, 'Material id')
}

async function deleteMaterialIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
  scope?: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!token || !id) return
  if (scope) {
    await scopedApiRequest(request, 'DELETE', '/api/materials', {
      token,
      data: { id },
      ...scope,
    }).catch(() => undefined)
  } else {
    await apiRequest(request, 'DELETE', '/api/materials', { token, data: { id } }).catch(() => undefined)
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

test.describe('TC-MAT-002: Material Sales Profile', () => {
  test('PUT creates profile and flips is_sellable, DELETE clears it', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let materialId: string | null = null

    try {
      materialId = await createMaterial(request, token, `MAT002-${stamp}`, `Profile ${stamp}`)

      const initialGet = await apiRequest(
        request,
        'GET',
        `/api/materials/${encodeURIComponent(materialId)}/sales-profile`,
        { token },
      )
      expect(initialGet.status()).toBe(200)
      const initialBody = await readJsonSafe<SalesProfileResponse>(initialGet)
      expect(initialBody?.exists).toBe(false)
      expect(initialBody?.profile).toBeNull()

      const gtin = '04001234567893'
      const putResponse = await apiRequest(
        request,
        'PUT',
        `/api/materials/${encodeURIComponent(materialId)}/sales-profile`,
        { token, data: { gtin, commodityCode: '847130' } },
      )
      expect(putResponse.status()).toBe(201)

      const afterCreate = await getMaterialById(request, token, materialId)
      expect(afterCreate?.is_sellable, 'is_sellable should flip true after profile create').toBe(true)

      const idempotentResponse = await apiRequest(
        request,
        'PUT',
        `/api/materials/${encodeURIComponent(materialId)}/sales-profile`,
        { token, data: { gtin, commodityCode: '847130' } },
      )
      expect(idempotentResponse.status(), 'Second PUT should return 200 (update)').toBe(200)

      const stillSellable = await getMaterialById(request, token, materialId)
      expect(stillSellable?.is_sellable).toBe(true)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/materials/${encodeURIComponent(materialId)}/sales-profile`,
        { token },
      )
      expect(deleteResponse.status()).toBe(200)

      const afterDelete = await getMaterialById(request, token, materialId)
      expect(afterDelete?.is_sellable, 'is_sellable should flip false after profile delete').toBe(false)
    } finally {
      await deleteMaterialIfExists(request, token, materialId)
    }
  })

  test('rejects PUT against non-existent material with 404', async ({ request }) => {
    const token = await getAuthToken(request)
    const fakeId = '00000000-0000-4000-8000-000000000999'

    const response = await apiRequest(
      request,
      'PUT',
      `/api/materials/${encodeURIComponent(fakeId)}/sales-profile`,
      { token, data: { gtin: '04001234567909' } },
    )
    expect(response.status(), `Expected 404 for unknown material: ${response.status()}`).toBe(404)
  })

  test('enforces gtin uniqueness within org and allows the same gtin cross-org', async ({ request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminScope = getTokenScope(adminToken)
    const stamp = Date.now()
    const sharedGtin = '04001234500006'

    let firstId: string | null = null
    let secondId: string | null = null
    let foreignOrgId: string | null = null
    let foreignMaterialId: string | null = null

    try {
      firstId = await createMaterial(request, adminToken, `MAT002-G1-${stamp}`, `Gtin first ${stamp}`)
      secondId = await createMaterial(request, adminToken, `MAT002-G2-${stamp}`, `Gtin second ${stamp}`)

      const firstPut = await apiRequest(
        request,
        'PUT',
        `/api/materials/${encodeURIComponent(firstId)}/sales-profile`,
        { token: adminToken, data: { gtin: sharedGtin } },
      )
      expect(firstPut.status()).toBe(201)

      const dupPut = await apiRequest(
        request,
        'PUT',
        `/api/materials/${encodeURIComponent(secondId)}/sales-profile`,
        { token: adminToken, data: { gtin: sharedGtin } },
      )
      expect(
        dupPut.ok(),
        `Duplicate gtin within same org must fail: ${dupPut.status()}`,
      ).toBeFalsy()
      expect([409, 422, 500]).toContain(dupPut.status())

      const orgResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: adminScope.tenantId, name: `MAT002 Foreign Org ${stamp}` },
      })
      expect(orgResponse.status()).toBe(201)
      foreignOrgId = expectId(((await readJsonSafe<{ id?: string }>(orgResponse)) ?? {}).id, 'Foreign org id')

      foreignMaterialId = await createMaterial(
        request,
        superadminToken,
        `MAT002-XORG-${stamp}`,
        `Foreign ${stamp}`,
        { tenantId: adminScope.tenantId, organizationId: foreignOrgId },
      )

      const crossOrgPut = await scopedApiRequest(
        request,
        'PUT',
        `/api/materials/${encodeURIComponent(foreignMaterialId)}/sales-profile`,
        {
          token: superadminToken,
          data: { gtin: sharedGtin },
          tenantId: adminScope.tenantId,
          organizationId: foreignOrgId,
        },
      )
      expect(
        crossOrgPut.status(),
        `Cross-org gtin reuse should succeed: ${crossOrgPut.status()}`,
      ).toBe(201)
    } finally {
      await deleteMaterialIfExists(request, adminToken, firstId)
      await deleteMaterialIfExists(request, adminToken, secondId)
      if (foreignOrgId) {
        await deleteMaterialIfExists(request, superadminToken, foreignMaterialId, {
          tenantId: adminScope.tenantId,
          organizationId: foreignOrgId,
        })
      }
      await deleteOrganizationIfExists(request, superadminToken, foreignOrgId)
    }
  })
})
