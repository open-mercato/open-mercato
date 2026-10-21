import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('Required customer field labels fit their controls', () => {
  for (const editor of ['pay-links', 'templates']) {
    test(`Polish labels fit in the ${editor} editor`, async ({ page, baseURL }) => {
      await login(page, 'admin')
      await page.context().addCookies([
        { name: 'locale', value: 'pl', url: baseURL ?? 'http://localhost:3000' },
      ])
      await page.goto(`/backend/checkout/${editor}/create`)

      const requiredControls = page.getByRole('checkbox', { name: 'Wymagane', exact: true })
      await expect(requiredControls).toHaveCount(7)

      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const control of await requiredControls.all()) {
          await expect(control).toBeVisible()
          await expect.poll(async () => control.evaluate((element) => {
            const label = element.closest('label')
            if (!label) return false
            const range = document.createRange()
            range.selectNodeContents(label)
            const content = range.getBoundingClientRect()
            const border = label.getBoundingClientRect()
            return content.left >= border.left && content.right <= border.right
              && content.top >= border.top && content.bottom <= border.bottom
          })).toBe(true)
        }
      }
    })
  }
})
