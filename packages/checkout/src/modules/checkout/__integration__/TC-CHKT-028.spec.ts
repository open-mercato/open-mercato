import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

test.describe('TC-CHKT-028: Payment-gateway transactions DataTable shows injected Create Payment Link toolbar action', () => {
  test('renders the checkout toolbar shortcut on the payment transactions page', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/payment-gateways')

    const actionLink = page.getByRole('link', { name: /create payment link/i })
    await expect(actionLink).toBeVisible()
    await expect(actionLink).toHaveAttribute('href', '/backend/checkout/pay-links/create')
  })
})
