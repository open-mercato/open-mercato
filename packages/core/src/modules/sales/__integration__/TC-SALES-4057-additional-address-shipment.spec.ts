import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

function readId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  for (const key of ['id', 'entityId', 'result']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
    const nested = readId(value)
    if (nested) return nested
  }
  return null
}

async function deleteDocumentAddress(
  request: APIRequestContext,
  token: string,
  addressId: string | null,
  orderId: string | null,
): Promise<void> {
  if (!addressId || !orderId) return
  const query = `id=${encodeURIComponent(addressId)}&documentId=${encodeURIComponent(orderId)}&documentKind=order`
  await apiRequest(request, 'DELETE', `/api/sales/document-addresses?${query}`, { token }).catch(() => undefined)
}

async function loginAdmin(page: Page): Promise<string> {
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ email: 'admin@acme.com', password: 'secret' }).toString(),
  })
  expect(response.ok(), `Admin login failed: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe<{ token?: string }>(response)
  expect(payload?.token).toBeTruthy()
  const token = payload!.token!
  const scope = getTokenScope(token)
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl },
    { name: 'om_selected_tenant', value: scope.tenantId, url: baseUrl },
    { name: 'om_selected_org', value: scope.organizationId, url: baseUrl },
  ])
  return token
}

test.describe('TC-SALES-4057: additional document address in shipment dialog', () => {
  test('loads an additional address once without trapping the shipment dialog in a request loop', async ({ page, request }) => {
    const token = await loginAdmin(page)
    const stamp = Date.now()
    const addressLine = `${stamp} Shipment Lane`
    let orderId: string | null = null
    let orderLineId: string | null = null
    let addressId: string | null = null
    let addressRequests = 0
    let countAddressRequest: ((request: Request) => void) | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)
      orderLineId = await createOrderLineFixture(request, token, orderId, { name: `QA shipment line ${stamp}` })
      const createResponse = await apiRequest(request, 'POST', '/api/sales/document-addresses', {
        token,
        data: {
          documentId: orderId,
          documentKind: 'order',
          purpose: 'additional',
          name: `QA Shipment Address ${stamp}`,
          addressLine1: addressLine,
          city: 'Warsaw',
          country: 'PL',
        },
      })
      expect(createResponse.ok(), `Document address create failed: ${createResponse.status()}`).toBeTruthy()
      addressId = readId(await readJsonSafe(createResponse))
      expect(addressId).toBeTruthy()

      await page.goto(`/backend/sales/orders/${encodeURIComponent(orderId)}?kind=order`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Shipments' }).click()
      countAddressRequest = (candidate) => {
        const url = new URL(candidate.url())
        if (
          candidate.method() === 'GET'
          && url.pathname === '/api/sales/document-addresses'
          && url.searchParams.get('documentId') === orderId
          && url.searchParams.get('documentKind') === 'order'
        ) {
          addressRequests += 1
        }
      }
      page.on('request', countAddressRequest)
      await page.getByRole('button', { name: 'Add shipment' }).first().click()

      const dialog = page.getByRole('dialog', { name: 'Add shipment' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(addressLine)).toBeVisible()
      await expect(dialog.getByText(/Loading shipments/)).toHaveCount(0)
      await expect(dialog.getByRole('textbox').first()).toBeEnabled()
      await page.waitForTimeout(750)
      expect(addressRequests, 'Document address lookup should settle after one request').toBe(1)
    } finally {
      if (countAddressRequest) page.off('request', countAddressRequest)
      await deleteDocumentAddress(request, token, addressId, orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/order-lines', orderLineId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
