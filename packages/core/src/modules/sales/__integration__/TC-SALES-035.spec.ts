import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-035: Document-address CRUD scoped to an order.
 *
 * Issue #2459 scenario "TC-SALES-034 — Document Address CRUD and Order Scoping" (P1).
 * Renumbered to 035: TC-SALES-030 is already taken (read-model totals, #2455/#2457).
 *
 * Document addresses (`/api/sales/document-addresses`) are polymorphic over a parent
 * `documentId` + `documentKind` (order|quote) and are feature-gated by the parent
 * document kind (`sales.orders.*` / `sales.quotes.*`).
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

function requiredFeatures(body: JsonRecord): string[] {
  return Array.isArray(body.requiredFeatures) ? (body.requiredFeatures as string[]) : []
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
          await apiRequest(
            request,
            'GET',
            `/api/sales/document-addresses?documentId=${encodeURIComponent(orderId)}&documentKind=order`,
            { token },
          ),
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
          await apiRequest(
            request,
            'GET',
            `/api/sales/document-addresses?documentId=${encodeURIComponent(orderId)}&documentKind=order`,
            { token },
          ),
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
          await apiRequest(
            request,
            'GET',
            `/api/sales/document-addresses?documentId=${encodeURIComponent(orderId)}&documentKind=order`,
            { token },
          ),
        ),
      )
      expect(afterDelete.some((row) => row.id === addressId)).toBeFalsy()
      addressId = null
    } finally {
      await deleteDocumentAddress(request, token, addressId, orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('requires sales document-address features for order address reads and writes', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    const email = `qa-sales-address-denied-${stamp}@acme.com`
    const password = `QaAddr1!${stamp}`
    let roleId: string | null = null
    let userId: string | null = null
    let orderId: string | null = null
    let quoteId: string | null = null
    let addressId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `QA Sales Address Denied ${stamp}`,
        tenantId: scope.tenantId ?? undefined,
      })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['sales.settings.view', 'sales.quotes.manage'] })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId!,
        roles: [roleId],
        name: `QA Sales Address Denied ${stamp}`,
      })

      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token: adminToken,
        data: { currencyCode: 'USD' },
      })
      expect(orderResponse.status()).toBe(201)
      orderId = (await readJson(orderResponse)).id as string

      const quoteResponse = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token: adminToken,
        data: { currencyCode: 'USD' },
      })
      expect(quoteResponse.status()).toBe(201)
      quoteId = (await readJson(quoteResponse)).id as string

      const createAddressResponse = await apiRequest(request, 'POST', '/api/sales/document-addresses', {
        token: adminToken,
        data: {
          documentId: orderId,
          documentKind: 'order',
          purpose: 'billing',
          addressLine1: '403 Guard Street',
          city: 'Forbidden',
          country: 'US',
        },
      })
      expect(createAddressResponse.status()).toBe(201)
      addressId = (await readJson(createAddressResponse)).id as string

      const cachePrimingList = await apiRequest(
        request,
        'GET',
        `/api/sales/document-addresses?documentId=${encodeURIComponent(orderId!)}&documentKind=order`,
        { token: adminToken },
      )
      expect(cachePrimingList.status(), 'admin GET should be allowed before denied read').toBe(200)

      const deniedToken = await getAuthToken(request, email, password)

      const listDenied = await apiRequest(
        request,
        'GET',
        `/api/sales/document-addresses?documentId=${encodeURIComponent(orderId!)}&documentKind=order`,
        { token: deniedToken },
      )
      expect(listDenied.status(), 'GET without sales.orders.view should be 403').toBe(403)
      expect(requiredFeatures(await readJson(listDenied))).toContain('sales.orders.view')

      const createDenied = await apiRequest(request, 'POST', '/api/sales/document-addresses', {
        token: deniedToken,
        data: {
          documentId: orderId,
          documentKind: 'order',
          purpose: 'shipping',
          addressLine1: 'Blocked Create Street',
        },
      })
      expect(createDenied.status(), 'POST without sales.orders.manage should be 403').toBe(403)
      expect(requiredFeatures(await readJson(createDenied))).toContain('sales.orders.manage')

      const updateDenied = await apiRequest(request, 'PUT', '/api/sales/document-addresses', {
        token: deniedToken,
        data: {
          id: addressId,
          documentId: orderId,
          documentKind: 'order',
          purpose: 'billing',
          addressLine1: 'Blocked Update Street',
        },
      })
      expect(updateDenied.status(), 'PUT without sales.orders.manage should be 403').toBe(403)
      expect(requiredFeatures(await readJson(updateDenied))).toContain('sales.orders.manage')

      const spoofedQuoteUpdateDenied = await apiRequest(request, 'PUT', '/api/sales/document-addresses', {
        token: deniedToken,
        data: {
          id: addressId,
          documentId: quoteId,
          documentKind: 'quote',
          purpose: 'billing',
          addressLine1: 'Blocked Spoof Street',
        },
      })
      expect(spoofedQuoteUpdateDenied.status(), 'PUT must authorize the stored order address kind').toBe(403)
      expect(requiredFeatures(await readJson(spoofedQuoteUpdateDenied))).toContain('sales.orders.manage')

      const spoofedQuoteUpdateAdminDenied = await apiRequest(request, 'PUT', '/api/sales/document-addresses', {
        token: adminToken,
        data: {
          id: addressId,
          documentId: quoteId,
          documentKind: 'quote',
          purpose: 'billing',
          addressLine1: 'Blocked Admin Spoof Street',
        },
      })
      expect(spoofedQuoteUpdateAdminDenied.status(), 'PUT must reject a parent-kind mismatch even for admin').toBe(404)

      const deleteDenied = await apiRequest(
        request,
        'DELETE',
        `/api/sales/document-addresses?id=${encodeURIComponent(addressId!)}&documentId=${encodeURIComponent(orderId!)}&documentKind=order`,
        { token: deniedToken },
      )
      expect(deleteDenied.status(), 'DELETE without sales.orders.manage should be 403').toBe(403)
      expect(requiredFeatures(await readJson(deleteDenied))).toContain('sales.orders.manage')

      const spoofedQuoteDeleteDenied = await apiRequest(
        request,
        'DELETE',
        `/api/sales/document-addresses?id=${encodeURIComponent(addressId!)}&documentId=${encodeURIComponent(quoteId!)}&documentKind=quote`,
        { token: adminToken },
      )
      expect(spoofedQuoteDeleteDenied.status(), 'DELETE must reject a parent-kind mismatch even for admin').toBe(404)

      const afterSpoofedDelete = listItems(
        await readJson(
          await apiRequest(
            request,
            'GET',
            `/api/sales/document-addresses?documentId=${encodeURIComponent(orderId!)}&documentKind=order`,
            { token: adminToken },
          ),
        ),
      )
      expect(afterSpoofedDelete.some((row) => row.id === addressId)).toBeTruthy()
    } finally {
      await deleteDocumentAddress(request, adminToken, addressId, orderId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/quotes', quoteId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
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
