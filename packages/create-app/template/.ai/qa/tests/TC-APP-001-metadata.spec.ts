import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-APP-001: Template metadata', () => {
  test('home page exposes localized app metadata', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveTitle('Open Mercato')
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /AI.?supportive, modular ERP foundation for product & service companies/,
    )
  })

  test('backend pages resolve translated and direct titles', async ({ page }) => {
    await login(page, 'admin')

    await page.goto('/backend/example', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle('Example Admin')

    await page.goto('/backend/products', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle('Products')
  })
})
