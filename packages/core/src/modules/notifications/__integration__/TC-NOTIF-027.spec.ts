import { expect } from '@playwright/test'
import { openKeyboardNotification, test } from './helpers/keyboardFixtures'

test.describe('TC-NOTIF-027: Polish notification filters on narrow screens', () => {
  for (const width of [320, 375]) {
    test(`all filter labels remain reachable at ${width}px`, async ({ page, keyboardFixture }) => {
      await page.setViewportSize({ width, height: 900 })
      await openKeyboardNotification(page, keyboardFixture, 'pl')
      const tabs = page.getByRole('tablist')
      const action = tabs.getByRole('tab', { name: 'Wymagana akcja', exact: true })

      await tabs.evaluate((list) => {
        const scroller = list.parentElement
        if (scroller) scroller.scrollLeft = scroller.scrollWidth
      })

      await expect.poll(async () => action.evaluate((tab) => {
        const label = tab.querySelector('span')
        const bounds = tab.getBoundingClientRect()
        return bounds.left >= 0
          && bounds.right <= window.innerWidth
          && label !== null
          && label.scrollWidth <= label.clientWidth
      })).toBe(true)
      await action.click()
      await expect(action).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByText(keyboardFixture.title, { exact: true })).toBeVisible()

      await tabs.evaluate((list) => {
        const scroller = list.parentElement
        if (scroller) scroller.scrollLeft = 0
      })
      const all = tabs.getByRole('tab', { name: 'Wszystkie', exact: true })
      await expect(all).toBeInViewport({ ratio: 1 })
      await all.click()
      await expect(all).toHaveAttribute('aria-selected', 'true')
    })
  }
})
