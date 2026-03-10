import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-UMES-020: Payment Gateway demo page renders and mock flow works
 */
test.describe('TC-UMES-020: Payment Gateway demo page', () => {
  test('should render the payment demo page and complete mock payment lifecycle', async ({ page, request }) => {
    const token = await getAuthToken(request)
    await login(page, 'admin')

    // Navigate to payment demo page
    await page.goto('/backend/payments')
    await expect(page.getByText('Payment Gateway Demo')).toBeVisible()

    // Verify setup instructions are visible
    await expect(page.getByText('How to Configure Payment Gateways')).toBeVisible()
    await expect(page.getByText('Mock Gateway')).toBeVisible()

    // Click "Pay with Mock Gateway"
    await page.getByRole('button', { name: /Pay with Mock Gateway/i }).click()

    // Wait for transaction details to appear
    await expect(page.getByText('Transaction Details')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('authorized')).toBeVisible()

    // Capture the payment
    await page.getByRole('button', { name: /Capture/i }).click()
    await expect(page.getByText('capture successful')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('captured')).toBeVisible()

    // Refund the payment
    await page.getByRole('button', { name: /Refund/i }).click()
    await expect(page.getByText('refund successful')).toBeVisible({ timeout: 10_000 })
  })

  test('should create a mock payment session via API', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
      token,
      data: {
        providerKey: 'mock',
        amount: 19.99,
        currencyCode: 'USD',
        captureMethod: 'manual',
        description: 'QA TC-UMES-020 test',
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()
    expect(data.transactionId).toBeTruthy()
    expect(data.status).toBe('authorized')
  })
})
