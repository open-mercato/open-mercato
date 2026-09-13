import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createSalesOrderFixture } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

const BILLING_SNAPSHOT = {
  name: 'QA Contact Fixture',
  addressLine1: '12 Market Street',
  city: 'London',
  postalCode: 'SW1A 1AA',
  country: 'GB',
  phone: '+48 600 100 200',
  taxId: 'PL1234567890',
  taxIdType: 'eu_vat',
}

async function putOrder(
  request: APIRequestContext,
  token: string,
  orderId: string,
  data: Record<string, unknown>,
) {
  return request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { id: orderId, ...data },
  })
}

async function readOrder(request: APIRequestContext, token: string, orderId: string) {
  const response = await request.fetch(resolveUrl(`/api/sales/orders?id=${encodeURIComponent(orderId)}`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  expect(response.status(), 'GET /api/sales/orders?id=... should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, 'response should include the requested order').toBeTruthy()
  return item as Record<string, unknown>
}

test.describe('TC-SALES-ADDR-CONTACT-001: document address detail round-trip', () => {
  let token: string
  let orderId: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request)
    orderId = await createSalesOrderFixture(request, token)
    const response = await putOrder(request, token, orderId, {
      billingAddressSnapshot: BILLING_SNAPSHOT,
    })
    expect(response.status(), 'seeding the billing snapshot should succeed').toBe(200)
  })

  test.afterAll(async ({ request }) => {
    if (!orderId) return
    await request.fetch(resolveUrl('/api/sales/orders'), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { id: orderId },
    })
  })

  test('the snapshot round-trips the contact keys through the API', async ({ request }) => {
    const item = await readOrder(request, token, orderId)
    const snapshot = (item.billingAddressSnapshot ?? item.billing_address_snapshot) as
      | Record<string, unknown>
      | undefined
    expect(snapshot, 'order should carry the billing snapshot').toBeTruthy()
    expect(snapshot).toMatchObject({
      phone: '+48 600 100 200',
      taxId: 'PL1234567890',
      taxIdType: 'eu_vat',
    })
  })

  test('the detail page saves and reloads the tax id and phone', async ({ page, request }) => {
    await login(page)
    await page.goto(resolveUrl(`/backend/sales/orders/${orderId}`), { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Addresses' }).click()

    const taxIdInput = page.getByRole('textbox', { name: 'Tax number' })
    const phoneInput = page.getByRole('textbox', { name: 'Phone' })
    await expect(taxIdInput).toHaveValue('PL1234567890')
    await expect(phoneInput).toHaveValue('+48 600 100 200')

    await taxIdInput.fill('PL9876543210')
    await phoneInput.fill('+48 600 900 800')
    const updateResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/sales/orders' &&
        response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Update addresses' }).click()
    const updateResponse = await updateResponsePromise
    expect(updateResponse.ok(), `Address update failed: ${updateResponse.status()}`).toBeTruthy()

    const item = await readOrder(request, token, orderId)
    const snapshot = (item.billingAddressSnapshot ?? item.billing_address_snapshot) as
      | Record<string, unknown>
      | undefined
    expect(snapshot).toMatchObject({
      phone: '+48 600 900 800',
      taxId: 'PL9876543210',
      taxIdType: 'eu_vat',
    })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Addresses' }).click()
    await expect(page.getByRole('textbox', { name: 'Tax number' })).toHaveValue('PL9876543210')
    await expect(page.getByRole('textbox', { name: 'Phone' })).toHaveValue('+48 600 900 800')
    await expect(page.getByText('EU VAT')).toHaveCount(2)
    await expect(page.getByText(/eu_vat/)).toHaveCount(0)
    await expect(page.getByText('12 Market Street, PL9876543210')).toHaveCount(0)
  })
})
