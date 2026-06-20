import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-035: Document-address CRUD scoped to an order.
 *
 * Issue #2459 scenario "TC-SALES-034 — Document Address CRUD and Order Scoping" (P1).
 * Renumbered to 035: TC-SALES-030 is already taken (read-model totals, #2455/#2457).
 *
 * Document addresses (`/api/sales/document-addresses`) are polymorphic over a parent
 * `documentId` + `documentKind` (order|quote) and require auth only (no feature gate).
 * There is no `addressType` enum — the shipping/billing role is the free-text `purpose`
 * field, and the street is `addressLine1` (not `street`). `addressLine1` is the single
 * required address field; `country` is optional. PUT is a full replace (every required
 * field must be resent) and DELETE requires `id` + `documentId` + `documentKind`.
 */

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function listItems(body: JsonRecord): JsonRecord[] {
  return Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
}

async function deleteDocumentAddress(
  request: APIRequestContext,
  token: string | null,
  addressId: string | null,
  documentId: string | null,
): Promise<void> {
  if (!token || !addressId || !documentId) return
  const query = `id=${encodeURIComponent(addressId)}&documentId=${encodeURIComponent(documentId)}&documentKind=order`
  await apiRequest(request, 'DELETE', `/api/sales/document-addresses?${query}`, { token }).catch(() => undefined)
}

test.describe('TC-SALES-035 document address CRUD + order scoping', () => {
  test('creates, reads, updates, and deletes an order document address', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let orderId: string | null = null
    let addressId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(orderResponse.status()).toBe(201)
      orderId = (await readJson(orderResponse)).id as string
      expect(orderId).toBeTruthy()

      const createResponse = await apiRequest(request, 'POST', '/api/sales/document-addresses', {
        token,
        data: {
          documentId: orderId,
          documentKind: 'order',
          name: `QA Ship ${stamp}`,
          purpose: 'shipping',
          addressLine1: '123 Main St',
          city: 'Springfield',
          postalCode: '12345',
          country: 'US',
        },
      })
      expect(createResponse.status(), 'POST /api/sales/document-addresses should be 201').toBe(201)
      addressId = (await readJson(createResponse)).id as string
      expect(addressId, 'create response should carry id').toBeTruthy()

      const listed = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/document-addresses?documentId=${encodeURIComponent(orderId)}`, { token }),
        ),
      )
      const created = listed.find((row) => row.id === addressId) ?? {}
      expect(created.address_line1).toBe('123 Main St')
      expect(created.city).toBe('Springfield')
      expect(created.postal_code).toBe('12345')
      expect(created.country).toBe('US')
      expect(created.purpose).toBe('shipping')

      // PUT is a full replace: every required field (documentId/documentKind/addressLine1) is resent.
      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/document-addresses', {
        token,
        data: {
          id: addressId,
          documentId: orderId,
          documentKind: 'order',
          purpose: 'shipping',
          addressLine1: '456 Oak Ave',
          city: 'Shelbyville',
          postalCode: '54321',
          country: 'US',
        },
      })
      expect(updateResponse.status(), 'PUT /api/sales/document-addresses should be 200').toBe(200)
      const afterUpdate = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/document-addresses?documentId=${encodeURIComponent(orderId)}`, { token }),
        ),
      ).find((row) => row.id === addressId) ?? {}
      expect(afterUpdate.address_line1).toBe('456 Oak Ave')
      expect(afterUpdate.city).toBe('Shelbyville')

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/sales/document-addresses?id=${encodeURIComponent(addressId)}&documentId=${encodeURIComponent(orderId)}&documentKind=order`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/sales/document-addresses should be 200').toBe(200)
      const afterDelete = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/document-addresses?documentId=${encodeURIComponent(orderId)}`, { token }),
        ),
      )
      expect(afterDelete.some((row) => row.id === addressId)).toBeFalsy()
      addressId = null
    } finally {
      await deleteDocumentAddress(request, token, addressId, orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('rejects a document address missing the required street line', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string

      const response = await apiRequest(request, 'POST', '/api/sales/document-addresses', {
        token,
        data: { documentId: orderId, documentKind: 'order', city: 'Nowhere', country: 'US' },
      })
      expect(response.status(), 'missing addressLine1 should be rejected with 400').toBe(400)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
