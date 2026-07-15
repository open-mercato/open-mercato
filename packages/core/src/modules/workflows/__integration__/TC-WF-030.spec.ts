import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-030: Checkout demo reaches customer information
 *
 * Guards issue #4179: upgraded tenants retained a persisted legacy checkout
 * definition whose cart-validation transition called an obsolete inventory
 * webhook. The migration aligns that persisted payload with the maintained,
 * self-contained code definition.
 */

const CODE_WORKFLOW_ID = 'workflows.checkout-demo'
const CODE_WORKFLOW_API_ID = `code:${CODE_WORKFLOW_ID}`

type DetailResponse = {
  data?: { id?: string }
}

type StartResponse = {
  data?: { instance?: { id?: string } }
}

test.describe('TC-WF-030: Checkout demo regression', () => {
  test('checkout advances past Cart Validation without an external inventory webhook', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const customerName = `QA Checkout Customer ${stamp}`
    const productTitle = `QA Checkout Product ${stamp}`
    let customerId: string | null = null
    let productId: string | null = null
    let overrideId: string | null = null
    let instanceId: string | null = null

    try {
      customerId = await createCompanyFixture(request, token, customerName)
      productId = await createProductFixture(request, token, {
        title: productTitle,
        sku: `QA-CHECKOUT-${stamp}`,
      })

      // Runtime transition handlers currently resolve persisted definitions by
      // definition_id. Materialize the maintained code payload just as the data
      // repair leaves the upgraded legacy row persisted and safe to execute.
      const customizeResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}/customize`,
        { token },
      )
      expect(customizeResponse.status()).toBe(200)
      const customized = await readJsonSafe<DetailResponse>(customizeResponse)
      overrideId = customized?.data?.id ?? null
      expect(overrideId).toBeTruthy()

      await login(page, 'admin')
      await page.goto('/checkout-demo')

      await page.locator('#customer-select').click()
      await page.getByRole('option', { name: customerName, exact: true }).click()

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
      expect(startResponse.status()).toBe(201)
      const started = await startResponse.json() as StartResponse
      instanceId = started?.data?.instance?.id ?? null
      expect(instanceId).toBeTruthy()

      // The demo exposes manual progression while an automated step is RUNNING.
      // Advance at most twice: START -> Cart Validation -> Customer Information.
      const advanceButton = page.getByRole('button', { name: 'Advance to Next Step →', exact: true })
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const customerStep = page.getByRole('heading', { name: 'Customer Information Required' })
        if (await customerStep.isVisible()) break
        await expect(advanceButton).toBeVisible()
        await Promise.all([
          page.waitForResponse((response) =>
            response.url().includes(`/api/workflows/instances/${instanceId}/advance`)
            && response.request().method() === 'POST'),
          advanceButton.click(),
        ])
      }

      await expect(page.getByRole('heading', { name: 'Customer Information Required' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Order Failed' })).toHaveCount(0)
      await expect(page.getByText(/CALL_WEBHOOK rejected unsafe URL|reason=invalid_url/)).toHaveCount(0)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, overrideId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', customerId)
    }
  })
})
