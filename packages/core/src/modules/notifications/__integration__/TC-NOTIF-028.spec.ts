import { expect, type Locator } from '@playwright/test'
import { notificationMessages, openKeyboardNotification, test } from './helpers/keyboardFixtures'

async function expectWithinViewport(control: Locator, width: number) {
  await expect(control).toBeVisible()
  const bounds = await control.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
  expect(await control.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
}

test.describe('TC-NOTIF-028: translated notification header controls fit the viewport', () => {
  for (const locale of ['en', 'pl'] as const) {
    test(`${locale} keeps mark all read and Close reachable, including while pending`, async ({ page, keyboardFixture }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await openKeyboardNotification(page, keyboardFixture, locale)
      const messages = notificationMessages[locale]
      const panel = page.getByRole('dialog', { name: messages['notifications.title'], exact: true })
      const markAll = panel.getByRole('button', { name: messages['notifications.markAllRead'], exact: true })
      const close = panel.getByRole('button', { name: messages['notifications.close'], exact: true })

      for (const width of [320, 375, 1280]) {
        await page.setViewportSize({ width, height: 812 })
        await expectWithinViewport(markAll, width)
        await expectWithinViewport(close, width)
      }

      await page.setViewportSize({ width: 375, height: 812 })
      await close.click()
      await expect(panel).toBeHidden()
      await openKeyboardNotification(page, keyboardFixture, locale)

      let releaseMutation = () => {}
      const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve })
      await page.route('**/api/notifications/mark-all-read', async (route) => {
        await mutationGate
        await route.continue()
      })
      try {
        const mutationResponse = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/notifications/mark-all-read' && response.request().method() === 'PUT',
        )
        await markAll.click()
        await expect(markAll).toBeDisabled()
        await expectWithinViewport(markAll, 375)
        await expectWithinViewport(close, 375)
        await test.info().attach(`${locale}-pending-header`, { body: await page.screenshot(), contentType: 'image/png' })
        releaseMutation()
        expect((await mutationResponse).status()).toBe(200)
        await expect(markAll).toBeHidden()
        expect((await keyboardFixture.read()).status).toBe('read')
      } finally {
        releaseMutation()
        await page.unroute('**/api/notifications/mark-all-read')
      }

      const reloadedCount = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/notifications/unread-count' && response.request().method() === 'GET',
      )
      await page.reload()
      expect(await (await reloadedCount).json()).toMatchObject({ unreadCount: 0 })
      await expect(page.getByRole('button', { name: messages['notifications.title'], exact: true })).toBeVisible()
    })
  }
})
