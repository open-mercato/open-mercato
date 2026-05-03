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
  name: string
  kind: string
  lifecycle_state: string
  is_purchasable: boolean
  is_sellable: boolean
  is_stockable: boolean
  is_producible: boolean
  organization_id: string
  tenant_id: string
}

type ListResponse = { items?: MaterialListItem[]; total?: number }

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

async function deleteMaterialIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', '/api/materials', { token, data: { id } }).catch(() => undefined)
}

async function deleteMaterialScopedIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!token || !id) return
  await scopedApiRequest(request, 'DELETE', '/api/materials', {
    token,
    data: { id },
    ...scope,
  }).catch(() => undefined)
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

test.describe('TC-MAT-001: Materials CRUD', () => {
  test('should support full CRUD lifecycle including custom fields', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    const code = `MAT001-${stamp}`
    let materialId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/materials', {
        token,
        data: {
          code,
          name: `Material ${stamp}`,
          description: 'Created by TC-MAT-001',
          kind: 'raw',
          isPurchasable: true,
          isStockable: true,
          cf_internal_notes: 'TC-MAT-001 internal note',
        },
      })
      expect(createResponse.status(), `POST /api/materials failed: ${createResponse.status()}`).toBe(201)
      const createBody = await readJsonSafe<{ id?: string }>(createResponse)
      materialId = expectId(createBody?.id, 'Create response should include id')

      const created = await getMaterialById(request, token, materialId)
      expect(created, 'Created material should appear in GET').toBeTruthy()
      expect(created?.code).toBe(code)
      expect(created?.kind).toBe('raw')
      expect(created?.lifecycle_state).toBe('draft')
      expect(created?.is_sellable).toBe(false)
      expect(created?.is_purchasable).toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', '/api/materials', {
        token,
        data: {
          id: materialId,
          name: `Material ${stamp} (updated)`,
          description: 'Updated description',
          cf_internal_notes: 'Updated note',
        },
      })
      expect(updateResponse.ok(), `PUT /api/materials failed: ${updateResponse.status()}`).toBeTruthy()

      const updated = await getMaterialById(request, token, materialId)
      expect(updated?.name).toBe(`Material ${stamp} (updated)`)

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/materials', {
        token,
        data: { id: materialId },
      })
      expect(deleteResponse.ok(), `DELETE /api/materials failed: ${deleteResponse.status()}`).toBeTruthy()

      const afterDelete = await getMaterialById(request, token, materialId)
      expect(afterDelete, 'Soft-deleted material should not appear in default list').toBeFalsy()
      materialId = null
    } finally {
      await deleteMaterialIfExists(request, token, materialId)
    }
  })

  test('should reject duplicate code in same org and allow same code cross-org', async ({ request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminScope = getTokenScope(adminToken)

    const stamp = Date.now()
    const sharedCode = `MAT001-DUP-${stamp}`
    let firstId: string | null = null
    let secondId: string | null = null
    let foreignOrgId: string | null = null
    let foreignMaterialId: string | null = null

    try {
      const firstResponse = await apiRequest(request, 'POST', '/api/materials', {
        token: adminToken,
        data: { code: sharedCode, name: `First ${stamp}`, kind: 'raw' },
      })
      expect(firstResponse.status()).toBe(201)
      firstId = expectId(((await readJsonSafe<{ id?: string }>(firstResponse)) ?? {}).id, 'First create id')

      const dupResponse = await apiRequest(request, 'POST', '/api/materials', {
        token: adminToken,
        data: { code: sharedCode, name: `Dup ${stamp}`, kind: 'raw' },
      })
      expect(dupResponse.status(), 'Duplicate code in same org should fail').toBeGreaterThanOrEqual(400)
      expect([409, 422, 400]).toContain(dupResponse.status())
      if (dupResponse.ok()) {
        secondId = expectId(((await readJsonSafe<{ id?: string }>(dupResponse)) ?? {}).id, 'Unexpected second id')
      }

      const orgResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: {
          tenantId: adminScope.tenantId,
          name: `MAT001 Foreign Org ${stamp}`,
        },
      })
      expect(orgResponse.status()).toBe(201)
      foreignOrgId = expectId(((await readJsonSafe<{ id?: string }>(orgResponse)) ?? {}).id, 'Foreign org id')

      const crossOrgResponse = await scopedApiRequest(request, 'POST', '/api/materials', {
        token: superadminToken,
        data: { code: sharedCode, name: `Foreign ${stamp}`, kind: 'raw' },
        tenantId: adminScope.tenantId,
        organizationId: foreignOrgId,
      })
      expect(
        crossOrgResponse.status(),
        `Cross-org duplicate code should succeed: ${crossOrgResponse.status()}`,
      ).toBe(201)
      foreignMaterialId = expectId(
        ((await readJsonSafe<{ id?: string }>(crossOrgResponse)) ?? {}).id,
        'Foreign material id',
      )
    } finally {
      await deleteMaterialIfExists(request, adminToken, firstId)
      await deleteMaterialIfExists(request, adminToken, secondId)
      if (foreignOrgId) {
        await deleteMaterialScopedIfExists(request, superadminToken, foreignMaterialId, {
          tenantId: adminScope.tenantId,
          organizationId: foreignOrgId,
        })
      }
      await deleteOrganizationIfExists(request, superadminToken, foreignOrgId)
    }
  })

  test('should isolate materials across organizations on GET', async ({ request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminScope = getTokenScope(adminToken)

    const stamp = Date.now()
    let foreignOrgId: string | null = null
    let foreignMaterialId: string | null = null

    try {
      const orgResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: {
          tenantId: adminScope.tenantId,
          name: `MAT001 Iso Org ${stamp}`,
        },
      })
      expect(orgResponse.status()).toBe(201)
      foreignOrgId = expectId(((await readJsonSafe<{ id?: string }>(orgResponse)) ?? {}).id, 'Foreign org id')

      const createResponse = await scopedApiRequest(request, 'POST', '/api/materials', {
        token: superadminToken,
        data: { code: `MAT001-ISO-${stamp}`, name: `Foreign ${stamp}`, kind: 'tool' },
        tenantId: adminScope.tenantId,
        organizationId: foreignOrgId,
      })
      expect(createResponse.status()).toBe(201)
      foreignMaterialId = expectId(
        ((await readJsonSafe<{ id?: string }>(createResponse)) ?? {}).id,
        'Foreign material id',
      )

      const adminView = await getMaterialById(request, adminToken, foreignMaterialId)
      expect(adminView, 'Material in foreign org must not be visible in admin scope').toBeFalsy()

      const foreignView = await getMaterialById(request, superadminToken, foreignMaterialId, {
        tenantId: adminScope.tenantId,
        organizationId: foreignOrgId,
      })
      expect(foreignView, 'Material in foreign org must be visible to scoped superadmin').toBeTruthy()
    } finally {
      if (foreignOrgId) {
        await deleteMaterialScopedIfExists(request, superadminToken, foreignMaterialId, {
          tenantId: adminScope.tenantId,
          organizationId: foreignOrgId,
        })
      }
      await deleteOrganizationIfExists(request, superadminToken, foreignOrgId)
    }
  })

  test('should reject direct mutation of is_sellable via PUT /api/materials', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let materialId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/materials', {
        token,
        data: { code: `MAT001-SELL-${stamp}`, name: `Sellable guard ${stamp}`, kind: 'raw' },
      })
      expect(createResponse.status()).toBe(201)
      materialId = expectId(((await readJsonSafe<{ id?: string }>(createResponse)) ?? {}).id, 'Create id')

      const camelResponse = await apiRequest(request, 'PUT', '/api/materials', {
        token,
        data: { id: materialId, isSellable: true },
      })
      expect(
        camelResponse.ok(),
        `Direct isSellable mutation must fail: ${camelResponse.status()}`,
      ).toBeFalsy()
      expect([400, 422]).toContain(camelResponse.status())

      const snakeResponse = await apiRequest(request, 'PUT', '/api/materials', {
        token,
        data: { id: materialId, is_sellable: true },
      })
      expect(
        snakeResponse.ok(),
        `Direct is_sellable mutation must fail: ${snakeResponse.status()}`,
      ).toBeFalsy()
      expect([400, 422]).toContain(snakeResponse.status())

      const after = await getMaterialById(request, token, materialId)
      expect(after?.is_sellable).toBe(false)
    } finally {
      await deleteMaterialIfExists(request, token, materialId)
    }
  })
})
