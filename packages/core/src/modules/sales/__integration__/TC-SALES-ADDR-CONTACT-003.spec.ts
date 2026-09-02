import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

test('TC-SALES-ADDR-CONTACT-003: locked orders disable address contact fields', async ({
  page,
  request,
}) => {
  const token = await getAuthToken(request)
  let orderId: string | null = null

  try {
    orderId = await createSalesOrderFixture(request, token)
    const seedResponse = await request.fetch(resolveUrl('/api/sales/orders'), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        id: orderId,
        billingAddressSnapshot: {
          name: 'QA locked contact fixture',
          addressLine1: '12 Browser Street',
          city: 'London',
          postalCode: 'SW1A 1AA',
          phone: '+44 20 1234 5678',
          taxId: 'GB123456789',
          taxIdType: 'eu_vat',
        },
      },
    })
    expect(seedResponse.status(), 'seeding the billing snapshot should succeed').toBe(200)

    await page.route('**/api/sales/settings/order-editing', async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as Record<string, unknown>
      await route.fulfill({
        response,
        json: { ...body, orderAddressEditableStatuses: [] },
      })
    })
    await login(page)
    await page.goto(resolveUrl(`/backend/sales/orders/${orderId}`), {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('button', { name: 'Addresses' }).click()

    await expect(
      page
        .getByRole('paragraph')
        .filter({ hasText: 'Addresses cannot be changed for the current status.' }),
    ).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Tax id type' })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: 'Tax number' })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: 'Phone' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Update addresses' })).toBeDisabled()
  } finally {
    await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
  }
})
