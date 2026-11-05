import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

test.describe('TC-CHKT-020: Checkout sidebar section visible with checkout.view feature via route metadata', () => {
  test('shows the checkout section and pay-links navigation for an admin user', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend')

    await expect(page.getByText(/^Checkout$/).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /pay links/i })).toBeVisible()
  })
})
