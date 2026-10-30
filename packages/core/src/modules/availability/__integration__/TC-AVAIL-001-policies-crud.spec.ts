import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  bumpRecordViaApi,
  expectConflictBody,
  putWithLock,
  readUpdatedAt,
  resolveApiUrl,
} from '@open-mercato/core/helpers/integration/optimisticLockUi'

/**
 * TC-AVAIL-001 — `availability` policy CRUD, ACL gating, tenant isolation, and
 * optimistic locking.
 *
 * Covers spec §12 "Service behaviour" (policy CRUD surface) and "API paths"
 * (tenant isolation) for `.ai/specs/2026-08-14-availability-contract.md`.
 * Reservation-behaviour cases are Phase 3 (out of scope, not tested here).
 */

const POLICIES_API_BASE = '/api/availability/policies'

type JsonRecord = Record<string, unknown>

function scopeCookie(tenantId: string, organizationId: string | null): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`,
  ].join('; ')
}

async function apiRequestWithCookie(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(resolveApiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

test.describe('TC-AVAIL-001: Availability policy CRUD, ACL, tenant isolation, optimistic lock', () => {
  test('creates, lists, updates, and deletes a product-level policy', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()
    const productId = `00000000-0000-4000-8000-${String(stamp).slice(-12).padStart(12, '0')}`

    let policyId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: {
          tenantId,
          organizationId,
          productId,
          variantId: null,
          allowBackorder: true,
          backorderLeadTimeDays: 5,
          lowStockThreshold: 3,
        },
      })
      expect(createResponse.status(), 'POST /api/availability/policies should return 201').toBe(201)
      const createBody = await readJsonSafe<{ id?: string }>(createResponse)
      policyId = expectId(createBody?.id, 'create response should contain an id')

      const listResponse = await apiRequest(request, 'GET', `${POLICIES_API_BASE}?productId=${productId}`, { token })
      expect(listResponse.status(), 'GET should return 200').toBe(200)
      const listBody = await readJsonSafe<{ items?: JsonRecord[]; total?: number }>(listResponse)
      const items = listBody?.items ?? []
      expect(items.some((item) => item.id === policyId)).toBe(true)
      const created = items.find((item) => item.id === policyId)!
      expect(created.allowBackorder).toBe(true)
      expect(created.backorderLeadTimeDays).toBe(5)

      const updateResponse = await apiRequest(request, 'PUT', POLICIES_API_BASE, {
        token,
        data: { id: policyId, lowStockThreshold: 9 },
      })
      expect(updateResponse.status(), 'PUT should return 200').toBe(200)

      const afterUpdate = await apiRequest(request, 'GET', `${POLICIES_API_BASE}?productId=${productId}`, { token })
      const afterUpdateBody = await readJsonSafe<{ items?: JsonRecord[] }>(afterUpdate)
      const updated = (afterUpdateBody?.items ?? []).find((item) => item.id === policyId)
      expect(updated?.lowStockThreshold).toBe(9)

      const deleteResponse = await apiRequest(request, 'DELETE', `${POLICIES_API_BASE}?id=${policyId}`, { token })
      expect(deleteResponse.status(), 'DELETE should return 200').toBe(200)
      policyId = null

      const afterDelete = await apiRequest(request, 'GET', `${POLICIES_API_BASE}?productId=${productId}`, { token })
      const afterDeleteBody = await readJsonSafe<{ items?: JsonRecord[] }>(afterDelete)
      expect((afterDeleteBody?.items ?? []).some((item) => item.id === createBody?.id)).toBe(false)
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, policyId)
    }
  })

  test('a view-only role can list but not create policies (ACL gating)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const employeeToken = await getAuthToken(request, 'employee')
    const stamp = Date.now()
    const productId = `00000000-0000-4000-8000-${String(stamp).slice(-12).padStart(12, '0')}`

    const viewResponse = await apiRequest(request, 'GET', POLICIES_API_BASE, { token: employeeToken })
    expect(viewResponse.status(), 'employee GET should be allowed by availability.policies.view').toBe(200)

    const createResponse = await apiRequest(request, 'POST', POLICIES_API_BASE, {
      token: employeeToken,
      data: { tenantId, organizationId, productId },
    })
    expect(createResponse.status(), 'employee POST should be forbidden without availability.policies.manage').toBe(403)
  })

  test('isolates policies per tenant', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId: tenantAId, organizationId: orgAId } = getTokenContext(adminToken)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = Date.now()
    const productId = `00000000-0000-4000-8000-${String(stamp).slice(-12).padStart(12, '0')}`

    let policyAId: string | null = null
    let tenantBId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token: adminToken,
        data: { tenantId: tenantAId, organizationId: orgAId, productId, isActive: true },
      })
      expect(createResponse.status(), 'creating tenant A policy should succeed').toBe(201)
      policyAId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'tenant A policy id')

      const tenantBResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA AVAIL 001 Tenant B ${stamp}` },
      })
      expect(tenantBResponse.status(), 'creating tenant B should succeed').toBe(201)
      tenantBId = expectId((await readJsonSafe<{ id?: string }>(tenantBResponse))?.id, 'tenant B id')

      const cookie = scopeCookie(tenantBId, null)
      const crossTenantList = await apiRequestWithCookie(request, 'GET', `${POLICIES_API_BASE}?productId=${productId}`, {
        token: superadminToken,
        cookie,
      })
      expect(crossTenantList.status(), 'tenant B scoped GET should return 200').toBe(200)
      const crossTenantBody = await readJsonSafe<{ items?: JsonRecord[] }>(crossTenantList)
      expect(
        (crossTenantBody?.items ?? []).some((item) => item.id === policyAId),
        "tenant B must never see tenant A's policy",
      ).toBe(false)

      const crossTenantById = await apiRequestWithCookie(request, 'GET', `${POLICIES_API_BASE}?id=${policyAId}`, {
        token: superadminToken,
        cookie,
      })
      const crossTenantByIdBody = await readJsonSafe<{ items?: JsonRecord[] }>(crossTenantById)
      expect(
        (crossTenantByIdBody?.items ?? []).length,
        "a direct id lookup scoped to tenant B must not resolve tenant A's policy",
      ).toBe(0)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, POLICIES_API_BASE, policyAId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantBId)
    }
  })

  test('rejects a stale update with a 409 conflict', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()
    const productId = `00000000-0000-4000-8000-${String(stamp).slice(-12).padStart(12, '0')}`

    let policyId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: { tenantId, organizationId, productId },
      })
      expect(createResponse.status()).toBe(201)
      policyId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'policy id')

      const staleUpdatedAt = await readUpdatedAt(request, token, POLICIES_API_BASE, policyId)

      // Advance updated_at out-of-band so the previously-read value is now stale.
      await bumpRecordViaApi(request, token, POLICIES_API_BASE, { id: policyId, lowStockThreshold: 2 })

      const staleResponse = await putWithLock(
        request,
        token,
        POLICIES_API_BASE,
        { id: policyId, lowStockThreshold: 4 },
        staleUpdatedAt,
      )
      await expectConflictBody(staleResponse)
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, policyId)
    }
  })
})
