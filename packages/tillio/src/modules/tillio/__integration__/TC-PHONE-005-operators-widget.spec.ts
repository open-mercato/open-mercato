import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-PHONE-005 — the operator configuration tab reaches the Tillio integration page.
 *
 * `tillio.injection.operators` is injected as a tab into this integration's detail spot,
 * which the integrations module renders from the `IntegrationDefinition`. The registration
 * chain (definition -> spot id -> injection table) has no compile-time link to the page, so
 * a break would silently drop the tab.
 *
 * The page opens on Credentials, so the tab is activated before asserting its body. With no
 * credentials stored the widget must guide the user to configure them instead of offering an
 * operator form — that guidance is the state a fresh tenant actually sees.
 */
test.describe('TC-PHONE-005: Tillio operators widget injection', () => {
  test('renders the operator configuration tab with not-ready guidance', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/integrations/tillio')

    await page.getByRole('tab', { name: 'Operator configuration' }).click()

    await expect(
      page.getByText('Save the Tillio API URL and key in the Credentials tab, then run the health Check before attaching an operator.'),
    ).toBeVisible()
  })
})
