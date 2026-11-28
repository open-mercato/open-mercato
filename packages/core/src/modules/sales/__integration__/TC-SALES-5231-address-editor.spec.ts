import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

test('saves and reloads the shipping custom field and retains its value when address editing is locked', async ({ page, request }) => {
  const token = await getAuthToken(request)
  const entityId = 'sales:sales_document_address'
  const key = 'qa_delivery_note_' + Date.now()
  const label = 'Address editor delivery note'
  let orderId: string | null = null
  try {
    const definition = await apiRequest(request, 'POST', '/api/entities/definitions', {
      token, data: { entityId, key, kind: 'text', configJson: { label, formEditable: true } },
    })
    expect(definition.ok()).toBeTruthy()
    orderId = await createSalesOrderFixture(request, token)
    const seed = await apiRequest(request, 'PUT', '/api/sales/orders', {
      token,
      data: {
        id: orderId,
        shippingAddressSnapshot: { addressLine1: '10 Demo Road', city: 'Sampletown', country: 'GB' },
        shippingAddressCustomValues: { [key]: 'Initial instructions' },
      },
    })
    expect(seed.ok()).toBeTruthy()

    await login(page)
    await page.goto('/backend/sales/orders/' + orderId)
    await page.getByRole('button', { name: 'Addresses', exact: true }).click()
    const input = page.getByRole('textbox', { name: label, exact: true })
    await expect(input).toHaveValue('Initial instructions')
    await input.fill('Updated loading bay')
    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/sales/orders' && response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Update addresses', exact: true }).click()
    expect((await saved).ok()).toBeTruthy()

    await page.route('**/api/sales/settings/order-editing', async (route) => {
      const response = await route.fetch()
      const settings = (await response.json()) as Record<string, unknown>
      await route.fulfill({ response, json: { ...settings, orderAddressEditableStatuses: [] } })
    })
    await page.reload()
    await page.getByRole('button', { name: 'Addresses', exact: true }).click()
    await expect(input).toHaveValue('Updated loading bay')
    await expect(input).toBeDisabled()
  } finally {
    await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    await apiRequest(request, 'DELETE', '/api/entities/definitions', { token, data: { entityId, key } })
  }
})
