import { expect } from '@playwright/test'
import {
  notificationMessages,
  observeNotificationEffects,
  openKeyboardNotification,
  test,
} from './helpers/keyboardFixtures'

test.describe('TC-NOTIF-027: Mark all read failure feedback and retry', () => {
  for (const locale of ['en', 'pl'] as const) {
    test(`${locale} preserves unread notifications on network failure and permits retry`, async ({ page, keyboardFixture }) => {
      await openKeyboardNotification(page, keyboardFixture, locale)
      const messages = notificationMessages[locale]
      const panel = page.getByRole('dialog', { name: messages['notifications.title'], exact: true })
      const button = panel.getByRole('button', { name: messages['notifications.markAllRead'], exact: true })
      const unreadTab = panel.getByRole('tab', { name: new RegExp(messages['notifications.filters.unread']) })
      await unreadTab.click()
      await expect(unreadTab).toContainText('2')
      const effects = observeNotificationEffects(page)
      const endpoint = '/api/notifications/mark-all-read'
      const pattern = `**${endpoint}`
      await page.route(pattern, (route) => route.abort('failed'))

      try {
        await button.click()
        await expect(panel.getByRole('alert')).toHaveText(messages['notifications.error.markAllRead'])
        await expect(button).toBeEnabled()
        await expect(unreadTab).toContainText('2')
        await expect(panel.getByText(keyboardFixture.title, { exact: true })).toBeVisible()
        expect(await keyboardFixture.read()).toEqual(keyboardFixture.before)
        await keyboardFixture.expectUnrelatedNotificationUnchanged()
        expect(effects.pageErrors).toEqual([])
        await test.info().attach(`${locale}-mark-all-read-failure`, {
          body: await page.screenshot(), contentType: 'image/png',
        })
      } finally {
        await page.unroute(pattern)
      }

      const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === endpoint && response.request().method() === 'PUT')
      await button.click()
      expect((await responsePromise).status()).toBe(200)
      await expect(panel.getByRole('alert')).toHaveCount(0)
      await expect(button).toHaveCount(0)
      await expect(panel.getByText(keyboardFixture.title, { exact: true })).toHaveCount(0)
      expect(await keyboardFixture.read('read')).toEqual({
        ...keyboardFixture.before,
        status: 'read',
        readAt: expect.any(String),
      })
      expect(effects.writes).toEqual([
        { method: 'PUT', path: endpoint, body: null },
        { method: 'PUT', path: endpoint, body: null },
      ])
      expect(effects.pageErrors).toEqual([])
      await test.info().attach(`${locale}-mark-all-read-retry`, {
        body: await page.screenshot(), contentType: 'image/png',
      })
    })
  }
})
