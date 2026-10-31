import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { login } from '@open-mercato/core/helpers/integration/auth'

const copy = JSON.parse(
  readFileSync(new URL('../i18n/pl.json', import.meta.url), 'utf8'),
) as Record<string, string>

test('locale update failure keeps the selected screen usable and can be retried without losing authentication', async ({ page }) => {
  await login(page, 'superadmin')
  const origin = new URL(page.url()).origin
  await page.context().addCookies([{ name: 'locale', value: 'en', url: origin }])
  await page.route('**/api/auth/locale', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    } else {
      await route.continue()
    }
  })
  await page.goto('/backend/finance-preview#s53')
  await expect(page.getByRole('alert').filter({ hasText: copy['finance_previews.page.localeError'] })).toBeVisible()
  await expect(page.getByTestId('tax-spec-s53')).toBeVisible()
  expect(page.url()).toBe(`${origin}/backend/finance-preview#s53`)
  await page.unroute('**/api/auth/locale')
  await page.getByRole('button', { name: copy['finance_previews.page.retry'], exact: true }).click()
  await expect(page.getByTestId('tax-spec-s53')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl')
  expect(page.url()).toBe(`${origin}/backend/finance-preview#s53`)
})
