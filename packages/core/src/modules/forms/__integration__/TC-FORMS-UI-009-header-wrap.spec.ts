import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createFormFixture, deleteFormIfExists } from '@open-mercato/core/helpers/integration/formsFixtures'

test.describe('TC-FORMS-UI-009: narrow studio header', () => {
  test('keeps translated actions and long metadata inside the viewport', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let formId: string | null = null

    try {
      const form = await createFormFixture(request, token, {
        key: `qa_${randomUUID().replaceAll('-', '')}`.padEnd(64, 'x'),
        name: `QA studio header ${randomUUID()} with a long form title`,
        supportedLocales: ['en', 'pl'],
      })
      formId = form.id
      await login(page, 'admin')
      await page.setViewportSize({ width: 375, height: 900 })

      for (const locale of ['en', 'pl', 'de']) {
        const dictionary = JSON.parse(readFileSync(new URL(`../i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>
        await page.context().addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
        await page.goto(`/backend/forms/${form.id}`, { waitUntil: 'domcontentloaded' })
        const publish = page.getByRole('button', { name: dictionary['forms.studio.actions.publish'], exact: true })
        const history = page.getByRole('link', { name: dictionary['forms.studio.actions.history'], exact: true })
        await expect(publish).toBeEnabled({ timeout: 60_000 })
        await expect(history).toBeVisible()

        for (const action of [publish, history]) {
          await expect.poll(async () => {
            const bounds = await action.boundingBox()
            return bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= 375
          }).toBe(true)
        }
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
      }
    } finally {
      await deleteFormIfExists(request, token, formId)
    }
  })
})
