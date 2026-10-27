import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AVAIL-004 — `GET /api/availability/policies/resolve-preview` and the
 * duplicate-target 409 on `POST /api/availability/policies`.
 *
 * Covers §12 "API paths" for the resolution-chain preview (US-A2), the
 * `availability_policies_scope_target_unique` conflict mapping, and the
 * inheritable `isStockManaged` on store-default rows (a default row created
 * only to set a threshold must not decide stock tracking).
 */

const POLICIES_API_BASE = '/api/availability/policies'
const PREVIEW_API_BASE = '/api/availability/policies/resolve-preview'

type FieldTrace = { value?: unknown; policySourceId?: string | null }
type PreviewBody = { policyTrace?: Record<string, FieldTrace> }

function syntheticUuid(stamp: number, suffix: string): string {
  return `00000000-0000-4000-${suffix}-${String(stamp).slice(-12).padStart(12, '0')}`
}

test.describe('TC-AVAIL-004: Policy resolve-preview and duplicate-target conflicts', () => {
  test('resolve-preview names the product-level row that decides each field', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()
    const productId = syntheticUuid(stamp, '8001')

    let policyId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: { tenantId, organizationId, productId, isStockManaged: true, lowStockThreshold: 7 },
      })
      expect(createResponse.status(), 'POST /api/availability/policies should return 201').toBe(201)
      policyId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'policy id')

      const previewResponse = await apiRequest(request, 'GET', `${PREVIEW_API_BASE}?productId=${productId}`, { token })
      expect(previewResponse.status(), 'GET resolve-preview should return 200').toBe(200)
      const body = await readJsonSafe<PreviewBody>(previewResponse)
      expect(body?.policyTrace?.lowStockThreshold).toEqual({ value: 7, policySourceId: policyId })
      expect(body?.policyTrace?.isStockManaged).toEqual({ value: true, policySourceId: policyId })
      expect(body?.policyTrace?.maxOrderQuantity?.value ?? null).toBeNull()
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, policyId)
    }
  })

  test('a store-default row created without isStockManaged inherits it instead of deciding it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()
    const productId = syntheticUuid(stamp, '8002')
    const storeId = syntheticUuid(stamp, '8003')

    let storeDefaultId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: { tenantId, organizationId, storeId, lowStockThreshold: 5 },
      })
      expect(createResponse.status(), 'creating a store-default policy should return 201').toBe(201)
      storeDefaultId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'store-default policy id')

      const listResponse = await apiRequest(request, 'GET', `${POLICIES_API_BASE}?id=${storeDefaultId}`, { token })
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<{ id?: string; isStockManaged?: boolean | null }> }>(listResponse)
      expect(listBody?.items?.[0]?.isStockManaged, 'an omitted isStockManaged is stored as inherit (null)').toBeNull()

      const previewResponse = await apiRequest(
        request,
        'GET',
        `${PREVIEW_API_BASE}?productId=${productId}&storeId=${storeId}`,
        { token },
      )
      expect(previewResponse.status()).toBe(200)
      const body = await readJsonSafe<PreviewBody>(previewResponse)
      expect(body?.policyTrace?.lowStockThreshold).toEqual({ value: 5, policySourceId: storeDefaultId })
      expect(
        body?.policyTrace?.isStockManaged?.policySourceId,
        'the store-default row must not decide isStockManaged when it leaves it unset',
      ).not.toBe(storeDefaultId)
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, storeDefaultId)
    }
  })

  test('resolve-preview rejects a request without a productId with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PREVIEW_API_BASE, { token })
    expect(response.status(), 'missing productId should be a 400').toBe(400)
    const body = await readJsonSafe<{ error?: string }>(response)
    expect(typeof body?.error).toBe('string')
  })

  test('a view-only role can read the resolve-preview', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const productId = syntheticUuid(Date.now(), '8004')
    const response = await apiRequest(request, 'GET', `${PREVIEW_API_BASE}?productId=${productId}`, {
      token: employeeToken,
    })
    expect(response.status(), 'employee GET should be allowed by availability.policies.view').toBe(200)
  })

  test('creating a second policy for the same target returns 409', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()
    const productId = syntheticUuid(stamp, '8005')

    let policyId: string | null = null
    let duplicateId: string | null = null
    try {
      const firstResponse = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: { tenantId, organizationId, productId, lowStockThreshold: 1 },
      })
      expect(firstResponse.status()).toBe(201)
      policyId = expectId((await readJsonSafe<{ id?: string }>(firstResponse))?.id, 'policy id')

      const duplicateResponse = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: { tenantId, organizationId, productId, lowStockThreshold: 2 },
      })
      const duplicateBody = await readJsonSafe<{ id?: string; error?: string }>(duplicateResponse)
      duplicateId = duplicateBody?.id ?? null
      expect(duplicateResponse.status(), 'a duplicate store/product/variant target should be a 409').toBe(409)
      expect(typeof duplicateBody?.error, 'the 409 should carry an inline error message').toBe('string')
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, duplicateId)
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, policyId)
    }
  })
})
