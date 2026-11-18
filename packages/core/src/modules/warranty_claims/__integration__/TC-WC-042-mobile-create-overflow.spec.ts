import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

async function expectViewportContained(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0)
}

test.describe('TC-WC-042: warranty claim create form stays inside the phone viewport', () => {
  test('the claim-line table scrolls locally instead of widening the page at 390px', async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `tc-wc-042-${Date.now()}`
    let customerId: string | null = null
    let orderId: string | null = null

    try {
      customerId = await createCompanyFixture(request, token, `WC-042 customer ${stamp}`)
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: {
          customerEntityId: customerId,
          currencyCode: 'USD',
          lines: [{ currencyCode: 'USD', name: `WC-042 imported line with a deliberately long product description ${stamp}`, quantity: 2, unitPriceNet: 10, unitPriceGross: 12 }],
        },
      })
      const orderBody = await readJsonSafe<{ id?: string; orderId?: string }>(orderResponse)
      expect(orderResponse.ok(), `order creation failed: ${JSON.stringify(orderBody)}`).toBeTruthy()
      orderId = expectId(orderBody?.id ?? orderBody?.orderId, 'sales order id')

      await page.setViewportSize({ width: 390, height: 844 })
      await login(page, 'admin')
      await page.goto(`/backend/warranty_claims/create?claimType=return&orderId=${orderId}`)
      await expect(page.getByRole('button', { name: 'Add from order', exact: true })).toBeVisible()

      await page.getByRole('button', { name: 'Add from order', exact: true }).click()
      const orderDialog = page.getByRole('dialog')
      await expect(orderDialog.getByRole('checkbox').first()).toBeVisible()
      await orderDialog.getByRole('checkbox').first().check()
      await orderDialog.getByRole('button', { name: 'Add selected lines', exact: true }).click()

      await expect(page.getByText(`WC-042 imported line with a deliberately long product description ${stamp}`).first()).toBeVisible()
      await expectViewportContained(page)
      await page.screenshot({ path: testInfo.outputPath('create-390.png'), fullPage: true })

      const firstRow = page.locator('tbody tr').first()
      await firstRow.getByRole('button').last().click()
      await expect(page.getByRole('menuitem', { name: 'Edit line', exact: true })).toBeVisible()
      await expectViewportContained(page)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', customerId)
    }
  })
})
