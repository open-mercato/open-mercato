import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const MASKED_SECRET_VALUE = '__om_secret_unchanged__'

const integrationDetail = {
  integration: {
    id: 'gateway_stripe',
    title: 'Stripe',
    description: 'Stripe integration',
    category: 'payment',
    credentials: {
      fields: [
        { key: 'publishableKey', label: 'Publishable Key', type: 'text', required: true },
        { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
        { key: 'webhookSecret', label: 'Webhook Signing Secret', type: 'secret', required: true },
      ],
    },
  },
  state: {
    isEnabled: false,
    apiVersion: null,
    reauthRequired: false,
    lastHealthStatus: null,
    lastHealthCheckedAt: null,
    lastHealthLatencyMs: null,
    enabledAt: null,
    updatedAt: '2026-08-21T12:00:00.000Z',
  },
  hasCredentials: true,
  credentialsUpdatedAt: '2026-08-21T12:00:00.000Z',
  healthStatus: 'unconfigured',
  analytics: {
    lastActivityAt: null,
    totalCount: 0,
    errorCount: 0,
    errorRate: 0,
    dailyCounts: [0, 0, 0, 0, 0, 0, 0],
  },
}

test.describe('TC-INT-011: write-only integration secret editing', () => {
  test('keeps configured secrets out of editable values and submits explicit unchanged intent', async ({ page }) => {
    await login(page, 'admin')

    const submittedBodies: Array<Record<string, unknown>> = []

    await page.route('**/api/integrations/gateway_stripe', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(integrationDetail),
      })
    })
    await page.route('**/api/integrations/gateway_stripe/credentials', async (route) => {
      if (route.request().method() === 'PUT') {
        submittedBodies.push(route.request().postDataJSON() as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          credentials: {
            publishableKey: 'pk_test_ui',
            secretKey: MASKED_SECRET_VALUE,
            webhookSecret: MASKED_SECRET_VALUE,
          },
          secretFieldsConfigured: { secretKey: true, webhookSecret: true },
          updatedAt: '2026-08-21T12:00:00.000Z',
        }),
      })
    })
    await page.route('**/api/integrations/logs?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      })
    })

    await page.goto('/backend/integrations/gateway_stripe', { waitUntil: 'domcontentloaded' })

    const secretField = page.locator('[data-crud-field-id="secretKey"]')
    const secretInput = secretField.locator('input')
    await expect(secretInput).toBeVisible()
    await expect(secretInput).toHaveValue('')
    await expect(secretField).toContainText('Configured. Enter a new value to replace it.')
    await expect(page.getByText(MASKED_SECRET_VALUE, { exact: false })).toHaveCount(0)

    await secretField.getByRole('button', { name: 'Show password' }).click()
    await expect(secretInput).toHaveAttribute('type', 'text')
    await expect(secretInput).toHaveValue('')

    await page.getByRole('button', { name: 'Save Credentials' }).click()
    await expect.poll(() => submittedBodies.length).toBe(1)
    expect(submittedBodies[0]).toEqual({
      credentials: { publishableKey: 'pk_test_ui' },
      unchangedSecretFields: ['secretKey', 'webhookSecret'],
    })

    const reloadedSecretInput = page.locator('[data-crud-field-id="secretKey"] input')
    await expect(reloadedSecretInput).toBeVisible()
    await reloadedSecretInput.fill('rotated-secret')
    await page.getByRole('button', { name: 'Save Credentials' }).click()
    await expect.poll(() => submittedBodies.length).toBe(2)
    expect(submittedBodies[1]).toEqual({
      credentials: {
        publishableKey: 'pk_test_ui',
        secretKey: 'rotated-secret',
      },
      unchangedSecretFields: ['webhookSecret'],
    })
  })
})
