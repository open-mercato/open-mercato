import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))
const koreanAuth = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/ko.json'), 'utf8'),
) as Record<string, string>

test.describe('TC-AUTH-056: Korean locale switch', () => {
  test('switches the backend to Korean and preserves the locale after reload', async ({ page }) => {
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
        page.getByTestId('profile-dropdown').getByRole('button', { name: '한국어', exact: true }).click(),
      ])

      expect((await localeResponse).status()).toBe(200)
      await page.goto('/backend/users')

      const usersTitle = koreanAuth['auth.nav.users']
      await expect(page.getByRole('heading', { name: usersTitle, exact: true })).toBeVisible()
      await expect.poll(async () => {
        const localeCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'locale')
        return localeCookie?.value
      }).toBe('ko')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: usersTitle, exact: true })).toBeVisible()
    } finally {
      await page.request.post('/api/auth/locale', { data: { locale: 'en' } })
    }
  })
})
