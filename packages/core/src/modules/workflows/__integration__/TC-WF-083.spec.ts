import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { cancelWorkflowInstanceIfExists } from '@open-mercato/core/helpers/integration/workflowsFixtures'
import { expectId } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-WF-083: Checkout demo sends currency-rounded amounts to the order workflow
 *
 * The demo converts USD cart prices with the selected exchange rate and adds 8%
 * tax and a flat shipping fee. The `create_order` activity forwards those amounts
 * verbatim to the sales order API, so each one must already be a valid amount in
 * the order currency. A product without a catalog price uses the demo's 99.99
 * fallback; in EUR (rate 0.92) the raw float math yields 91.9908 / 7.359264 /
 * 9.1908 instead of 91.99 / 7.36 / 9.19.
 */

type StartRequestBody = {
  initialContext?: {
    cart?: {
      orderLines?: Array<{ unitPriceGross?: number }>
      orderAdjustments?: Array<{ kind?: string; amountGross?: number }>
      subtotal?: number
      tax?: number
      shipping?: number
      total?: number
    }
  }
}

type StartResponse = {
  data?: { instance?: { id?: string } }
}

test.describe('TC-WF-083: Checkout demo amount rounding', () => {
  test('converted prices, tax, shipping and total are sent rounded to cents', async ({ page, request }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const customerName = `QA Rounding Customer ${stamp}`
    const productTitle = `QA Rounding Product ${stamp}`
    let customerId: string | null = null
    let productId: string | null = null
    let instanceId: string | null = null

    try {
      customerId = await createCompanyFixture(request, token, customerName)
      productId = await createProductFixture(request, token, {
        title: productTitle,
        sku: `QA-ROUNDING-${stamp}`,
      })

      await login(page, 'admin')
      await page.goto('/checkout-demo')

      await page.locator('#customer-select').click()
      await page.getByRole('option', { name: customerName, exact: true }).click()

      await page.locator('#currency-select').click()
      await page.getByRole('option', { name: 'EUR - Euro', exact: true }).click()

      await page.locator('#product-select').click()
      await page.getByRole('option', { name: new RegExp(`^${productTitle}\\b`) }).click()

      const startButton = page.getByRole('button', { name: 'Start Checkout Workflow', exact: true })
      await expect(startButton).toBeEnabled()
      const [startResponse] = await Promise.all([
        page.waitForResponse((response) =>
          response.url().endsWith('/api/workflows/instances')
          && response.request().method() === 'POST'),
        startButton.click(),
      ])
      const started = await startResponse.json() as StartResponse
      instanceId = started?.data?.instance?.id ?? null
      expect(startResponse.status()).toBe(201)
      expectId(instanceId, 'Checkout demo should return a started workflow instance id')

      const cart = (startResponse.request().postDataJSON() as StartRequestBody).initialContext?.cart
      expect(cart?.orderLines?.map((line) => line.unitPriceGross)).toEqual([91.99])
      expect(cart?.orderAdjustments?.map((adjustment) => [adjustment.kind, adjustment.amountGross])).toEqual([
        ['shipping', 9.19],
        ['tax', 7.36],
      ])
      expect(cart?.subtotal).toBe(91.99)
      expect(cart?.tax).toBe(7.36)
      expect(cart?.shipping).toBe(9.19)
      expect(cart?.total).toBe(108.54)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', customerId)
    }
  })
})
