import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import english from '../i18n/en.json' with { type: 'json' }
import polish from '../i18n/pl.json' with { type: 'json' }

for (const [locale, dictionary] of [['en', english], ['pl', polish]] as const) {
  test(`custom entity help is localized in ${locale} on desktop and mobile`, async ({ page, baseURL }) => {
    await login(page, 'admin')
    await page.context().addCookies([{ name: 'locale', value: locale, url: baseURL ?? 'http://localhost:3000' }])
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/backend/entities/user')
      const help = page.getByRole('button', { name: new RegExp(dictionary['entities.userEntities.help.title']) })
      await expect(help).toBeVisible()
      await help.click()
      await expect(help).toHaveAttribute('aria-expanded', 'true')
      for (const key of ['description', 'fields', 'create', 'api'] as const) {
        await expect(page.getByText(dictionary[`entities.userEntities.help.${key}`], { exact: true })).toBeVisible()
      }
      if (locale === 'pl') await expect(page.getByText(english['entities.userEntities.help.title'], { exact: true })).toHaveCount(0)
    }
  })
}
