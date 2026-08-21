import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { cancelWorkflowInstanceIfExists, pollWorkflowInstance } from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'
import { expectId } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-WF-030: Checkout demo reaches customer information
 *
 * Guards issue #4179 end-to-end on whatever state the tenant is in:
 * - Fresh installs have no persisted `workflows.checkout-demo` row; the runtime
 *   handlers resolve the virtual code definition via the code-registry fallback
 *   in `findDefinitionForInstance`.
 * - Upgraded tenants keep their persisted legacy row, repaired in place by
 *   Migration20260715120000 to match the maintained self-contained payload.
 * The test deliberately does NOT materialize a DB row first — that would mask
 * the cold-start path a new install actually exercises.
 */

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
    let instanceId: string | null = null

    try {
      customerId = await createCompanyFixture(request, token, customerName)
      productId = await createProductFixture(request, token, {
        title: productTitle,
        sku: `QA-CHECKOUT-${stamp}`,
      })

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
      const startedInstanceId = expectId(instanceId, 'Checkout demo should return a started workflow instance id')

      // Every checkout-demo transition is `trigger: 'auto'`, so the executor walks
      // START -> Cart Validation -> Customer Information on its own and parks on the
      // USER_TASK. The demo's manual progression is only a fallback for a stalled
      // executor, and it must be driven off the *server's* current step: clicking it
      // against a page that still renders the previous step advances the instance one
      // step too far, skipping the user task and leaving the run paused on payment
      // confirmation — the race that made this spec flaky in CI.
      const advanceButton = page.getByRole('button', { name: 'Advance to Next Step →', exact: true })
      const stepsBeforeCustomerInfo = new Set(['start', 'cart_validation'])

      // Poll budgets stay well inside the spec's 20 s timeout: they only elapse in full
      // when the executor really has stalled, which is exactly when the manual fallback
      // is supposed to fire. A healthy run leaves `start`/`cart_validation` in well
      // under a second and never waits.
      const stallBudgetsMs = [4_000, 3_000]

      for (let attempt = 0; attempt < stallBudgetsMs.length; attempt += 1) {
        const snapshot = await pollWorkflowInstance(
          request,
          token,
          startedInstanceId,
          (instance) => !stepsBeforeCustomerInfo.has(instance.currentStepId ?? ''),
          { timeoutMs: stallBudgetsMs[attempt] },
        )
        if (!stepsBeforeCustomerInfo.has(snapshot?.currentStepId ?? '')) break
        await expect(advanceButton).toBeVisible()
        await Promise.all([
          page.waitForResponse((response) =>
            response.url().includes(`/api/workflows/instances/${startedInstanceId}/advance`)
            && response.request().method() === 'POST'),
          advanceButton.click(),
        ])
      }

      await expect(page.getByRole('heading', { name: 'Customer Information Required', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Order Failed' })).toHaveCount(0)
      await expect(page.getByText(/CALL_WEBHOOK rejected unsafe URL|reason=invalid_url/)).toHaveCount(0)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', customerId)
    }
  })
})
