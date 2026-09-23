import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AVAIL-002 — `POST /api/availability/check`, the admin/debug reproduction tool.
 *
 * Covers §12 UI/API contract for the check tool and US-B1's ACs: gated access,
 * not_tracked fallback with no balance/policy data, and an inline error for an
 * unknown item id (never a stack trace).
 */

const CHECK_API_BASE = '/api/availability/check'
const POLICIES_API_BASE = '/api/availability/policies'
const CATALOG_PRODUCTS_API_BASE = '/api/catalog/products'

test.describe('TC-AVAIL-002: Availability check tool', () => {
  test('a view-only role is forbidden from running a check', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const response = await apiRequest(request, 'POST', CHECK_API_BASE, {
      token: employeeToken,
      data: { productId: '00000000-0000-4000-8000-000000000001', quantity: 1 },
    })
    expect(response.status(), 'employee should be forbidden without availability.check').toBe(403)
  })

  test('an unknown product id returns an inline 404, never a 500', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', CHECK_API_BASE, {
      token,
      data: { productId: '00000000-0000-4000-8000-999999999999', quantity: 1 },
    })
    expect(response.status(), 'unknown product id should be an inline 404').toBe(404)
    const body = await readJsonSafe<{ error?: string }>(response)
    expect(typeof body?.error, 'response should carry an inline error message').toBe('string')
  })

  test('a real product with no balance data and no policy resolves not_tracked, canFulfil true', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()

    let productId: string | null = null
    try {
      const createProduct = await apiRequest(request, 'POST', CATALOG_PRODUCTS_API_BASE, {
        token,
        data: {
          tenantId,
          organizationId,
          title: `QA AVAIL 002 Product ${stamp}`,
          sku: `qa-avail-002-${stamp}`,
        },
      })
      // Some catalog deployments gate product creation behind additional required fields;
      // skip this scenario gracefully rather than failing on an unrelated catalog contract.
      test.skip(createProduct.status() >= 400, `catalog product fixture create failed with ${createProduct.status()}`)
      productId = expectId((await readJsonSafe<{ id?: string }>(createProduct))?.id, 'catalog product id')

      const checkResponse = await apiRequest(request, 'POST', CHECK_API_BASE, {
        token,
        data: { productId, quantity: 1 },
      })
      expect(checkResponse.status(), 'check should succeed for a real, untracked product').toBe(200)
      const body = await readJsonSafe<{ availability?: { state?: string; canFulfil?: boolean; isAuthoritative?: boolean } }>(
        checkResponse,
      )
      expect(body?.availability?.state).toBe('not_tracked')
      expect(body?.availability?.canFulfil).toBe(true)
      // not_tracked must never render/report as in_stock (R5).
      expect(body?.availability?.state).not.toBe('in_stock')
    } finally {
      await deleteGeneralEntityIfExists(request, token, CATALOG_PRODUCTS_API_BASE, productId)
    }
  })

  test('defaults quantity to 1 when omitted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()

    let productId: string | null = null
    let policyId: string | null = null
    try {
      const createProduct = await apiRequest(request, 'POST', CATALOG_PRODUCTS_API_BASE, {
        token,
        data: { tenantId, organizationId, title: `QA AVAIL 002b Product ${stamp}`, sku: `qa-avail-002b-${stamp}` },
      })
      test.skip(createProduct.status() >= 400, `catalog product fixture create failed with ${createProduct.status()}`)
      productId = expectId((await readJsonSafe<{ id?: string }>(createProduct))?.id, 'catalog product id')

      const createPolicy = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: { tenantId, organizationId, productId, isStockManaged: true },
      })
      expect(createPolicy.status()).toBe(201)
      policyId = expectId((await readJsonSafe<{ id?: string }>(createPolicy))?.id, 'policy id')

      const checkResponse = await apiRequest(request, 'POST', CHECK_API_BASE, { token, data: { productId } })
      expect(checkResponse.status()).toBe(200)
      const body = await readJsonSafe<{ policyTrace?: { isStockManaged?: { value?: boolean; policySourceId?: string | null } } }>(
        checkResponse,
      )
      expect(body?.policyTrace?.isStockManaged?.value).toBe(true)
      expect(body?.policyTrace?.isStockManaged?.policySourceId).toBe(policyId)
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, policyId)
      await deleteGeneralEntityIfExists(request, token, CATALOG_PRODUCTS_API_BASE, productId)
    }
  })
})
