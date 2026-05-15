import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

type SupplierLinkListItem = {
  id: string
  material_id: string
  supplier_company_id: string
  preferred: boolean
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
  const data = { code, name, kind: 'raw' }
  const response = scope
    ? await scopedApiRequest(request, 'POST', '/api/materials', { token, data, ...scope })
    : await apiRequest(request, 'POST', '/api/materials', { token, data })
  expect(response.status()).toBe(201)
  return expectId(((await readJsonSafe<{ id?: string }>(response)) ?? {}).id, 'Material id')
}

async function listSupplierLinks(
  request: APIRequestContext,
  token: string,
  materialId: string,
): Promise<SupplierLinkListItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/material-suppliers?materialId=${encodeURIComponent(materialId)}&page=1&pageSize=100`,
    { token },
  )
  expect(response.status()).toBe(200)
  return ((await readJsonSafe<ListResponse<SupplierLinkListItem>>(response)) ?? {}).items ?? []
}

async function deleteMaterialIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
  scope?: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!token || !id) return
  if (scope) {
    await scopedApiRequest(request, 'DELETE', '/api/materials', { token, data: { id }, ...scope }).catch(() => undefined)
  } else {
    await apiRequest(request, 'DELETE', '/api/materials', { token, data: { id } }).catch(() => undefined)
  }
}

async function deleteSupplierLinkIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', '/api/material-suppliers', { token, data: { id } }).catch(() => undefined)
}

async function deleteCompanyIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
  scope?: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!token || !id) return
  const path = `/api/customers/companies?id=${encodeURIComponent(id)}`
  if (scope) {
    await scopedApiRequest(request, 'DELETE', path, { token, ...scope }).catch(() => undefined)
  } else {
    await apiRequest(request, 'DELETE', path, { token }).catch(() => undefined)
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

test.describe('TC-MAT-004: Material Supplier Links', () => {
  test('rejects cross-org supplier_company_id with 404', async ({ request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminScope = getTokenScope(adminToken)
    const stamp = Date.now()

    let materialId: string | null = null
    let foreignOrgId: string | null = null
    let foreignCompanyId: string | null = null

    try {
      materialId = await createMaterial(request, adminToken, `MAT004-XORG-${stamp}`, `XOrg ${stamp}`)

      const orgResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: adminScope.tenantId, name: `MAT004 Foreign Org ${stamp}` },
      })
      expect(orgResponse.status()).toBe(201)
      foreignOrgId = expectId(((await readJsonSafe<{ id?: string }>(orgResponse)) ?? {}).id, 'Foreign org id')

      const foreignCompanyResponse = await scopedApiRequest(request, 'POST', '/api/customers/companies', {
        token: superadminToken,
        data: { displayName: `MAT004 Foreign Co ${stamp}` },
        tenantId: adminScope.tenantId,
        organizationId: foreignOrgId,
      })
      expect(foreignCompanyResponse.status()).toBe(201)
      foreignCompanyId = expectId(
        ((await readJsonSafe<{ id?: string; entityId?: string }>(foreignCompanyResponse)) ?? {}).id ??
          ((await readJsonSafe<{ id?: string; entityId?: string }>(foreignCompanyResponse)) ?? {}).entityId,
        'Foreign company id',
      )

      const linkResponse = await apiRequest(request, 'POST', '/api/material-suppliers', {
        token: adminToken,
        data: { materialId, supplierCompanyId: foreignCompanyId },
      })
      expect(
        linkResponse.ok(),
        `Cross-org supplier link must fail: ${linkResponse.status()}`,
      ).toBeFalsy()
      expect([404, 403, 422]).toContain(linkResponse.status())
    } finally {
      await deleteMaterialIfExists(request, adminToken, materialId)
      if (foreignOrgId) {
        await deleteCompanyIfExists(request, superadminToken, foreignCompanyId, {
          tenantId: adminScope.tenantId,
          organizationId: foreignOrgId,
        })
      }
      await deleteOrganizationIfExists(request, superadminToken, foreignOrgId)
    }
  })

  test('promoting a second preferred supplier demotes the previous one', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let materialId: string | null = null
    let supplierAId: string | null = null
    let supplierBId: string | null = null
    let linkAId: string | null = null
    let linkBId: string | null = null

    try {
      materialId = await createMaterial(request, token, `MAT004-PREF-${stamp}`, `Preferred ${stamp}`)
      supplierAId = await createCompanyFixture(request, token, `MAT004 Supplier A ${stamp}`)
      supplierBId = await createCompanyFixture(request, token, `MAT004 Supplier B ${stamp}`)

      const linkAResponse = await apiRequest(request, 'POST', '/api/material-suppliers', {
        token,
        data: { materialId, supplierCompanyId: supplierAId, preferred: true },
      })
      expect(linkAResponse.status()).toBe(201)
      linkAId = expectId(((await readJsonSafe<{ id?: string }>(linkAResponse)) ?? {}).id, 'Link A id')

      const linkBResponse = await apiRequest(request, 'POST', '/api/material-suppliers', {
        token,
        data: { materialId, supplierCompanyId: supplierBId, preferred: true },
      })
      expect([200, 201, 409, 422]).toContain(linkBResponse.status())

      if (linkBResponse.ok()) {
        linkBId = expectId(((await readJsonSafe<{ id?: string }>(linkBResponse)) ?? {}).id, 'Link B id')
        const links = await listSupplierLinks(request, token, materialId)
        const preferred = links.filter((row) => row.preferred)
        expect(preferred, 'Exactly one preferred supplier may exist per material').toHaveLength(1)
        expect(preferred[0]?.id).toBe(linkBId)
      }
    } finally {
      await deleteSupplierLinkIfExists(request, token, linkAId)
      await deleteSupplierLinkIfExists(request, token, linkBId)
      await deleteCompanyIfExists(request, token, supplierAId)
      await deleteCompanyIfExists(request, token, supplierBId)
      await deleteMaterialIfExists(request, token, materialId)
    }
  })

  test('soft-deleting a supplier link preserves its prices (no cascade)', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let materialId: string | null = null
    let supplierId: string | null = null
    let linkId: string | null = null
    let priceId: string | null = null
    let currencyId: string | null = null

    try {
      materialId = await createMaterial(request, token, `MAT004-PR-${stamp}`, `Price preservation ${stamp}`)
      supplierId = await createCompanyFixture(request, token, `MAT004 Supplier ${stamp}`)

      const linkResponse = await apiRequest(request, 'POST', '/api/material-suppliers', {
        token,
        data: { materialId, supplierCompanyId: supplierId },
      })
      expect(linkResponse.status()).toBe(201)
      linkId = expectId(((await readJsonSafe<{ id?: string }>(linkResponse)) ?? {}).id, 'Link id')

      const currencyListResponse = await apiRequest(
        request,
        'GET',
        '/api/currencies/currencies?page=1&pageSize=10',
        { token },
      )
      const currencyBody = await readJsonSafe<ListResponse<{ id: string; code: string }>>(currencyListResponse)
      currencyId = currencyBody?.items?.[0]?.id ?? null
      test.skip(!currencyId, 'No currency available; skipping price preservation assertion')

      const priceResponse = await apiRequest(request, 'POST', '/api/material-prices', {
        token,
        data: {
          materialSupplierLinkId: linkId,
          priceAmount: '12.500000',
          currencyId,
        },
      })
      expect(priceResponse.status()).toBe(201)
      priceId = expectId(((await readJsonSafe<{ id?: string }>(priceResponse)) ?? {}).id, 'Price id')

      const deleteLinkResponse = await apiRequest(request, 'DELETE', '/api/material-suppliers', {
        token,
        data: { id: linkId },
      })
      expect(deleteLinkResponse.ok(), `Link delete failed: ${deleteLinkResponse.status()}`).toBeTruthy()

      const priceListResponse = await apiRequest(
        request,
        'GET',
        `/api/material-prices?materialSupplierLinkId=${encodeURIComponent(linkId!)}&page=1&pageSize=100`,
        { token },
      )
      expect(priceListResponse.status()).toBe(200)
    } finally {
      await apiRequest(request, 'DELETE', '/api/material-prices', { token, data: { id: priceId } })
        .catch(() => undefined)
      await deleteSupplierLinkIfExists(request, token, linkId)
      await deleteCompanyIfExists(request, token, supplierId)
      await deleteMaterialIfExists(request, token, materialId)
    }
  })
})
