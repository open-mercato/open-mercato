import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-PHONE-004 — the Pull widget reaches the hub's call list toolbar.
 *
 * This module injects `tillio.injection.pull-calls` into `data-table:phone_calls.calls:toolbar`,
 * a spot owned by phone_calls in another package. Nothing in either package fails to compile if
 * that wiring breaks — the button simply stops rendering — so the injection is asserted here.
 *
 * It lives in the provider package on purpose: phone_calls must keep passing with tillio
 * disabled, so its own page spec cannot assert a Tillio button.
 */
test.describe('TC-PHONE-004: Tillio pull widget injection', () => {
  test('renders the pull action on the phone calls list', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/phone_calls')

    await expect(page.getByRole('heading', { name: 'Phone Calls' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pull calls' })).toBeVisible()
  })
})
