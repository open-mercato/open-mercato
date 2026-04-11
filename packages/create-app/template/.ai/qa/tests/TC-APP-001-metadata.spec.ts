import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const baseUrl = process.env.BASE_URL || 'http://localhost:3000'

async function setGermanLocale(page: Page) {
  await page.context().addCookies([
    {
      name: 'locale',
      value: 'de',
      url: baseUrl,
      sameSite: 'Lax',
    },
  ])
}

test.describe('TC-APP-001: Template metadata', () => {
  test('home page exposes localized app metadata', async ({ page }) => {
    await setGermanLocale(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'KI-unterstützte, modulare ERP-Basis für Produkt- und Dienstleistungsunternehmen',
    )
  })

  test('backend pages resolve translated and direct titles', async ({ page }) => {
    await setGermanLocale(page)
    await login(page, 'admin')

    await page.goto('/backend/example', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle('Beispiel-Admin')

    await page.goto('/backend/products', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle('Products')
  })
})
