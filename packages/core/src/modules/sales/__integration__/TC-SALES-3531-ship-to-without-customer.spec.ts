import { expect, test, type Page } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

async function loginAdmin(page: Page): Promise<string> {
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ email: 'admin@acme.com', password: 'secret' }).toString(),
  })
  expect(response.ok(), `Admin login failed: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe<{ token?: string }>(response)
  const token = expectId(payload?.token, 'Admin login returned no token')
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

test.describe('TC-SALES-3531: ship-to address on an order without a customer', () => {
  test('defines the shipping address on the order and ships to it', async ({ page, request }) => {
    const token = await loginAdmin(page)
    const stamp = Date.now()
    const addressLine = `${stamp} No Customer Road`
    let orderId: string | null = null
    let shipmentId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: {
          currencyCode: 'USD',
          lines: [{ currencyCode: 'USD', quantity: 1, name: `QA no-customer line ${stamp}`, unitPriceNet: 10, unitPriceGross: 12 }],
        },
      })
      expect(orderResponse.ok(), `Order create failed: ${orderResponse.status()}`).toBeTruthy()
      const orderPayload = await readJsonSafe<{ id?: string; orderId?: string }>(orderResponse)
      orderId = expectId(orderPayload?.id ?? orderPayload?.orderId, 'Order create returned no id')

      await page.goto(`/backend/sales/orders/${encodeURIComponent(orderId)}?kind=order`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Addresses' }).click()

      const shippingCard = page
        .getByText('Shipping address', { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
      const defineNew = shippingCard.getByRole('switch', { name: 'Define new address' })
      await expect(defineNew).toBeEnabled()
      await defineNew.click()
      await shippingCard.getByRole('textbox', { name: 'Address line 1' }).fill(addressLine)
      await expect(shippingCard.getByRole('switch', { name: 'Save this address to the customer' })).toBeDisabled()

      const updateResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/sales/orders' && response.request().method() === 'PUT'
      })
      await page.getByRole('button', { name: 'Update addresses' }).click()
      const updateResponse = await updateResponsePromise
      expect(updateResponse.ok(), `Order address update failed: ${updateResponse.status()}`).toBeTruthy()
      await expect(page.getByRole('button', { name: 'Update addresses' })).toBeEnabled()

      await page.getByRole('button', { name: 'Shipments' }).click()
      await page.getByRole('button', { name: 'Add shipment' }).first().click()
      const dialog = page.getByRole('dialog', { name: 'Add shipment' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(addressLine)).toBeVisible()
      await page.keyboard.press('Escape')

      const linesResponse = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}`, { token })
      const lines = await readJsonSafe<{ items?: Array<{ id?: string }> }>(linesResponse)
      const orderLineId = expectId(lines?.items?.[0]?.id, 'Order has no line to ship')
      const shipmentResponse = await apiRequest(request, 'POST', '/api/sales/shipments', {
        token,
        data: {
          orderId,
          items: [{ orderLineId, quantity: 1 }],
          shipmentAddressSnapshot: { addressLine1: addressLine },
        },
      })
      expect(shipmentResponse.ok(), `Shipment create failed: ${shipmentResponse.status()}`).toBeTruthy()
      const shipmentPayload = await readJsonSafe<{ id?: string; shipmentId?: string }>(shipmentResponse)
      shipmentId = expectId(shipmentPayload?.id ?? shipmentPayload?.shipmentId, 'Shipment create returned no id')
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/sales/shipments', shipmentId)
      await deleteGeneralEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
