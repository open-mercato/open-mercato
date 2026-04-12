import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-UMES-013: Ephemeral login page suppresses global notice bars', () => {
  test.describe.configure({ timeout: 60_000 })

  test('login page hides demo and cookie notices in ephemeral integration mode', async ({ page }) => {
    test.skip(process.env.OM_INTEGRATION_TEST !== 'true', 'Notice-bar suppression is specific to ephemeral integration mode')
    test.slow()

    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 15_000 })

    await expect(page.getByRole('button', { name: /accept cookies/i })).toHaveCount(0)
    await expect(page.getByText(/demo environment/i)).toHaveCount(0)
    await expect(page.getByText(/this instance is provided for demo purposes only/i)).toHaveCount(0)

    await login(page, 'admin')

    await expect(page).toHaveURL(/\/backend(?:\/.*)?$/, { timeout: 20_000 })
  })
})
