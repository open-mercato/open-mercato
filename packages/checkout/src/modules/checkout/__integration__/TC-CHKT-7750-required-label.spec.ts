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

      for (const width of [1440, 1280, 1024, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const control of await requiredControls.all()) {
          await expect(control).toBeVisible()
          await expect.poll(async () => control.evaluate((element) => {
            const container = element.parentElement
            const label = container?.querySelector('label')
            if (!container || !label || label.htmlFor !== element.id) return false
            const range = document.createRange()
            range.selectNodeContents(label)
            const content = range.getBoundingClientRect()
            const checkbox = element.getBoundingClientRect()
            const border = container.getBoundingClientRect()
            return content.left >= border.left && content.right <= border.right
              && content.top >= border.top && content.bottom <= border.bottom
              && checkbox.left >= border.left && checkbox.right <= border.right
              && checkbox.top >= border.top && checkbox.bottom <= border.bottom
              && checkbox.width === 20 && checkbox.height === 20
          })).toBe(true)
        }
      }
    })
  }
})
