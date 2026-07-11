import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createOrderLineFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

function readId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  for (const key of ['id', 'entityId', 'orderId', 'result']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
    const nested = readId(value)
    if (nested) return nested
  }
  return null
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy()
  const id = readId(await readJsonSafe(response))
  expect(id, `No id in POST ${path} response`).toBeTruthy()
  return id!
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

test.describe('TC-SALES-4057: main address selected after order creation', () => {
  test('resolves the selected customer address and offers it in the shipment dialog', async ({ page, request }) => {
    const token = await loginAdmin(page)
    const scope = getTokenScope(token)
    const stamp = Date.now()
    const addressName = `QA Main Address ${stamp}`
    const addressLine = `${stamp} Main Shipping Street`
    let customerId: string | null = null
    let customerAddressId: string | null = null
    let orderId: string | null = null
    let orderLineId: string | null = null

    try {
      customerId = await createCompanyFixture(request, token, `QA Main Address Customer ${stamp}`)
      customerAddressId = await createEntity(request, token, '/api/customers/addresses', {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entityId: customerId,
        name: addressName,
        addressLine1: addressLine,
        city: 'Warsaw',
        country: 'PL',
      })
      const addressListResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/addresses?entityId=${encodeURIComponent(customerId)}`,
        { token },
      )
      const addressList = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(addressListResponse)
      expect(addressListResponse.ok()).toBeTruthy()
      expect(addressList?.items?.some((item) => item.id === customerAddressId)).toBe(true)
      orderId = await createEntity(request, token, '/api/sales/orders', {
        currencyCode: 'USD',
        customerEntityId: customerId,
      })
      orderLineId = await createOrderLineFixture(request, token, orderId, { name: `QA main address line ${stamp}` })

      await page.goto(`/backend/sales/orders/${encodeURIComponent(orderId)}?kind=order`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Addresses' }).click()

      const shippingCard = page.getByText('Shipping address', { exact: true }).locator('..').locator('..').locator('..')
      const shippingSelect = shippingCard.getByRole('combobox')
      await expect(shippingSelect).toBeEnabled()
      await shippingSelect.click()
      await page.getByRole('option').filter({ hasText: addressLine }).click()

      const updateResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/sales/orders' && response.request().method() === 'PUT'
      })
      await page.getByRole('button', { name: 'Update addresses' }).click()
      const updateResponse = await updateResponsePromise
      expect(updateResponse.ok(), `Order address update failed: ${updateResponse.status()}`).toBeTruthy()
      const updateBody = updateResponse.request().postDataJSON() as Record<string, unknown>
      expect(updateBody.shippingAddressId).toBe(customerAddressId)
      expect(Object.prototype.hasOwnProperty.call(updateBody, 'shippingAddressSnapshot')).toBe(false)

      await page.getByRole('button', { name: 'Shipments' }).click()
      await page.getByRole('button', { name: 'Add shipment' }).first().click()
      const dialog = page.getByRole('dialog', { name: 'Add shipment' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(addressLine)).toBeVisible()
      await expect(dialog.getByText(/No results/)).toHaveCount(0)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/order-lines', orderLineId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteEntityIfExists(request, token, '/api/customers/addresses', customerAddressId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', customerId)
    }
  })
})
