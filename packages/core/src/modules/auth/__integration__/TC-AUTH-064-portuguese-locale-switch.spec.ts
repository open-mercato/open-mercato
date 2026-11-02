import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))
const englishAuth = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/en.json'), 'utf8'),
) as Record<string, string>
const portugueseAuth = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/pt.json'), 'utf8'),
) as Record<string, string>

test.describe('TC-AUTH-064: Portuguese locale switch', () => {
  test('switches the backend to Portuguese, preserves it, and resets to English', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page, 'admin')

    try {
      await page.getByTestId('profile-dropdown-trigger').click()
      await page.getByRole('menuitem', { name: /Language/i }).click()

      const localeResponse = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/auth/locale' && response.request().method() === 'POST'
      })

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.getByTestId('profile-dropdown').getByRole('button', { name: 'Português', exact: true }).click(),
      ])

      expect((await localeResponse).status()).toBe(200)
      await page.goto('/backend/users')

      const usersTitle = portugueseAuth['auth.nav.users']
      await expect(page.getByRole('heading', { name: usersTitle, exact: true })).toBeVisible()
      await expect.poll(async () => {
        const localeCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'locale')
        return localeCookie?.value
      }).toBe('pt')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: usersTitle, exact: true })).toBeVisible()

      await page.getByTestId('profile-dropdown-trigger').click()
      await page.getByRole('menuitem', {
        name: new RegExp(`^${portugueseAuth['ui.profileMenu.language']} `),
      }).click()

      const resetLocaleResponse = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/auth/locale' && response.request().method() === 'POST'
      })

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.getByTestId('profile-dropdown').getByRole('button', { name: 'English', exact: true }).click(),
      ])

      expect((await resetLocaleResponse).status()).toBe(200)
      await page.goto('/backend/users')

      await expect(page.getByRole('heading', { name: englishAuth['auth.nav.users'], exact: true })).toBeVisible()
      await expect.poll(async () => {
        const localeCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'locale')
        return localeCookie?.value
      }).toBe('en')
    } finally {
      await page.request.post('/api/auth/locale', { data: { locale: 'en' } })
    }
  })
})
